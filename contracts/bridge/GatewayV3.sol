// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./RelayerManager.sol";
import "./WrappedToken.sol";
import "./ChainRegistry.sol";
import "./MessageLib.sol";

/**
 * @title GatewayV3
 * @notice Hybrid cross-chain gateway:
 *  - Token bridging (lock/mint, burn/release) with quorum signatures
 *  - Generalized message passing (cross-chain call) with quorum signatures
 *  - Chain + token allowlisting via ChainRegistry
 *  - Circuit breaker via Pausable
 */
contract GatewayV3 is Ownable, Pausable {
    RelayerManager public immutable relayerManager;
    ChainRegistry public immutable registry;

    // Tracks which source proofs/messages have already been consumed.
    mapping(bytes32 => bool) public usedProofs;

    // Simple incremental nonce for local events.
    uint256 public nonce;

    event TokensLocked(
        address indexed sender,
        address indexed token,
        uint256 amount,
        uint256 toChainId,
        address recipient,
        uint256 nonce
    );

    event TokensMinted(
        address indexed recipient,
        address indexed wrappedToken,
        uint256 amount,
        bytes32 sourceTxHash
    );

    event MessageSent(
        address indexed sender,
        uint256 toChainId,
        address indexed target,
        bytes data,
        uint256 value,
        uint256 nonce
    );

    event MessageExecuted(
        address indexed executor,
        address indexed target,
        uint256 fromChainId,
        bytes data,
        bool success
    );

    constructor(RelayerManager _relayerManager, ChainRegistry _registry) Ownable(msg.sender) {
        relayerManager = _relayerManager;
        registry = _registry;
    }

    // -------------------- SENDER SIDE --------------------

    /**
     * @notice Lock ERC-20 tokens on this chain for bridging.
     * @dev Only tokens/chainIds allowlisted in ChainRegistry are accepted.
     */
    function bridgeToken(
        address token,
        uint256 amount,
        uint256 toChainId,
        address recipient
    ) external whenNotPaused {
        require(registry.isChainEnabled(toChainId), "dest chain disabled");
        require(registry.isTokenAllowed(toChainId, token), "token not allowed");
        require(amount > 0, "amount = 0");

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");

        uint256 n = ++nonce;
        emit TokensLocked(msg.sender, token, amount, toChainId, recipient, n);
    }

    /**
     * @notice Emit a generic cross-chain message to be executed on another chain.
     */
    function sendMessage(
        uint256 toChainId,
        address target,
        bytes calldata data
    ) external payable whenNotPaused {
        require(registry.isChainEnabled(toChainId), "dest chain disabled");
        uint256 n = ++nonce;
        emit MessageSent(msg.sender, toChainId, target, data, msg.value, n);
    }

    // -------------------- RECEIVER SIDE --------------------

    /**
     * @notice Mint wrapped tokens on this chain corresponding to a lock on a source chain,
     *         once enough relayer signatures over the sourceTxHash have been collected.
     */
    function mintWrapped(
        address wrappedToken,
        address recipient,
        uint256 amount,
        bytes32 sourceTxHash,
        bytes[] calldata signatures
    ) external whenNotPaused {
        require(!usedProofs[sourceTxHash], "proof used");

        _verifyQuorum(sourceTxHash, signatures);
        usedProofs[sourceTxHash] = true;

        WrappedToken(wrappedToken).mint(recipient, amount);

        emit TokensMinted(recipient, wrappedToken, amount, sourceTxHash);
    }

    /**
     * @notice Execute an arbitrary message that originated from another chain,
     *         once enough relayer signatures are available over the message hash.
     *
     * @dev For now we fix the cross-chain nonce to 0 inside the hash and rely
     *      on sourceMsgHash + usedProofs for replay protection.
     */
    function executeMessage(
        uint256 fromChainId,
        address sender,
        address target,
        bytes calldata data,
        uint256 value,
        bytes32 sourceMsgHash,
        bytes[] calldata signatures
    ) external whenNotPaused {
        require(!usedProofs[sourceMsgHash], "proof used");

        bytes32 expected = MessageLib.hashMessage(
            0, // cross-chain nonce placeholder
            fromChainId,
            block.chainid,
            sender,
            target,
            data,
            value
        );
        require(expected == sourceMsgHash, "hash mismatch");

        _verifyQuorum(sourceMsgHash, signatures);
        usedProofs[sourceMsgHash] = true;

        (bool ok, ) = target.call{value: value}(data);

        emit MessageExecuted(msg.sender, target, fromChainId, data, ok);
    }

    // -------------------- ADMIN --------------------

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------- INTERNAL --------------------

    /**
     * @dev Validate that a sufficient number of unique, active relayers have signed `digest`.
     */
    function _verifyQuorum(
        bytes32 digest,
        bytes[] calldata sigs
    ) internal view {
        uint256 threshold = relayerManager.signatureThreshold();
        require(threshold > 0, "threshold=0");
        require(sigs.length >= threshold, "not enough signatures");

        address[] memory seen = new address[](sigs.length);

        for (uint256 i = 0; i < threshold; i++) {
            address signer = _recover(digest, sigs[i]);
            require(relayerManager.isRelayer(signer), "invalid signer");

            // O(n^2) uniqueness check is fine for small thresholds.
            for (uint256 j = 0; j < i; j++) {
                require(seen[j] != signer, "duplicate signature");
            }
            seen[i] = signer;
        }
    }

    /**
     * @dev Recover signer from an arbitrary digest using the standard
     *      `"\x19Ethereum Signed Message:\n32"` prefix.
     */
    function _recover(
        bytes32 digest,
        bytes memory signature
    ) internal pure returns (address) {
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        (bytes32 r, bytes32 s, uint8 v) = _split(signature);
        return ecrecover(ethHash, v, r, s);
    }

    function _split(
        bytes memory sig
    ) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "bad sig length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) {
            v += 27;
        }
    }
}
