// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./WrappedToken.sol";
import "./RelayerManager.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GatewayV2
 * @dev This gateway requires a threshold of signatures from a decentralized set of
 * relayers to authorize the minting of wrapped tokens.
 */
contract GatewayV2 is ReentrancyGuard {
    using ECDSA for bytes32;

    RelayerManager public immutable relayerManager;
    address public immutable wrappedToken;
    mapping(bytes32 => bool) public usedProofs; // Prevents replay attacks

    event TokensMinted(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed sourceTxHash
    );

    event MessageExecuted(
        address indexed target,
        bytes32 indexed sourceTxHash,
        bool success,
        bytes returnData
    );

    constructor(address _relayerManager, address _wrappedToken) {
        require(_relayerManager != address(0), "Invalid RelayerManager address");
        require(_wrappedToken != address(0), "Invalid WrappedToken address");
        relayerManager = RelayerManager(_relayerManager);
        wrappedToken = _wrappedToken;
    }

    /**
     * @dev Mints new wrapped tokens to a recipient after verifying a quorum of relayer signatures.
     * @param recipient The address that will receive the minted tokens.
     * @param amount The amount of tokens to mint.
     * @param sourceTxHash A unique hash from the source chain transaction to prevent replays.
     * @param signatures An array of signatures from the relayers.
     */
    function mint(
        address recipient,
        uint256 amount,
        bytes32 sourceTxHash,
        bytes[] calldata signatures
    ) external {
        require(!usedProofs[sourceTxHash], "Proof has already been used");

        uint256 relayerCount = relayerManager.getRelayerCount();
        uint256 requiredSignatures = (relayerCount * 2) / 3 + 1;

        require(signatures.length >= requiredSignatures, "Insufficient signatures");

    bytes32 proofHash = keccak256(abi.encodePacked(recipient, amount, sourceTxHash, block.chainid));
    // Construct Ethereum Signed Message hash ("\x19Ethereum Signed Message:\n32" + proofHash)
    bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", proofHash));

        address[] memory signers = new address[](signatures.length);

        for (uint i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(messageHash, signatures[i]);
            
            // Ensure the signer is an active relayer
            require(relayerManager.isRelayer(signer), "Signature from non-relayer");

            // Ensure signatures are unique
            for (uint j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate signature");
            }
            signers[i] = signer;
        }

        usedProofs[sourceTxHash] = true;

        // Mint through the configured WrappedToken contract. The WrappedToken should
        // have its owner set to this GatewayV2 instance so only this contract can mint.
        WrappedToken(wrappedToken).mint(recipient, amount);

        emit TokensMinted(recipient, amount, sourceTxHash);
    }

    /**
     * @dev Execute an arbitrary message on `target` after verifying a quorum of relayer signatures.
     * The proof is computed as keccak256(abi.encodePacked(target, payload, sourceTxHash, chainid)).
     * This function is protected by a reentrancy guard and checks payload size.
     */
    function executeMessage(
        address target,
        bytes calldata payload,
        bytes32 sourceTxHash,
        bytes[] calldata signatures
    ) external nonReentrant {
        require(target != address(0), "Invalid target");
        require(payload.length <= 4096, "Payload too large");
        require(!usedProofs[sourceTxHash], "Proof has already been used");

        uint256 relayerCount = relayerManager.getRelayerCount();
        uint256 requiredSignatures = (relayerCount * 2) / 3 + 1;
        require(signatures.length >= requiredSignatures, "Insufficient signatures");

        bytes32 proofHash = keccak256(abi.encodePacked(target, payload, sourceTxHash, block.chainid));
        bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", proofHash));

        address[] memory signers = new address[](signatures.length);
        for (uint i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(messageHash, signatures[i]);
            require(relayerManager.isRelayer(signer), "Signature from non-relayer");
            for (uint j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate signature");
            }
            signers[i] = signer;
        }

        usedProofs[sourceTxHash] = true;

        // Execute the payload on the target contract and emit result.
        (bool success, bytes memory ret) = target.call(payload);
        emit MessageExecuted(target, sourceTxHash, success, ret);
    }
}
