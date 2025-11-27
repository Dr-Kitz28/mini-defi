// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WrappedToken} from "./WrappedToken.sol";
import {ILightClient} from "../bridge/ILightClient.sol";

// We'll use a local ecrecover helper instead of OpenZeppelin ECDSA to avoid
// compatibility issues with different OZ versions in the test environment.

interface IGateway {
    function receiveTokens(
        address originalSender,
        address token,
        uint256 amount,
        uint256 fromChainId,
        bytes[] calldata signatures
    ) external;
}

contract Gateway is Ownable {
    // ...existing code...
    mapping(uint256 => address) public gateways;
    mapping(address => bool) public supportedTokens;
    mapping(address => address) public wrappedTokenMap; // originalToken -> wrappedToken

    mapping(address => bool) public isRelayer;
    uint256 public signatureThreshold;
    mapping(bytes32 => bool) public usedSignatures;
    bool public paused;
    address public multisig;

    event TokensSent(address indexed user, address indexed token, uint256 amount, uint256 toChainId);
    event TokensReceived(
        address indexed originalSender,
        address indexed token,
        uint256 amount,
        uint256 fromChainId
    );
    event TokensReleased(address indexed user, address indexed originalToken, uint256 amount, uint256 toChainId);
    event TokensUnlocked(address indexed user, address indexed originalToken, uint256 amount);
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event SignatureThresholdSet(uint256 newThreshold);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event MessageSent(address indexed sender, uint256 toChainId, bytes payload);
    event MessageReceived(address indexed executor, address indexed target, uint256 fromChainId, bytes payload, bool success);

    constructor(address admin, address[] memory initialRelayers, uint256 _signatureThreshold) Ownable(admin) {
        for (uint256 i = 0; i < initialRelayers.length; i++) {
            isRelayer[initialRelayers[i]] = true;
            emit RelayerAdded(initialRelayers[i]);
        }
        signatureThreshold = _signatureThreshold;
        emit SignatureThresholdSet(_signatureThreshold);
    }

    function setMultisig(address _multisig) external onlyOwner {
        multisig = _multisig;
    }

    receive() external payable {}

    // Pause / unpause can be executed either by the owner or via a multisig
    // contract that executes a transaction targeting this contract. This
    // allows governance operations (multisig) to pause bridge activity.
    function pause() external {
        require(msg.sender == owner() || msg.sender == multisig, "not authorized");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        require(msg.sender == owner() || msg.sender == multisig, "not authorized");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function addRelayer(address relayer) external onlyOwner {
        require(!isRelayer[relayer], "Already a relayer");
        isRelayer[relayer] = true;
        emit RelayerAdded(relayer);
    }

    function removeRelayer(address relayer) external onlyOwner {
        require(isRelayer[relayer], "Not a relayer");
        isRelayer[relayer] = false;
        emit RelayerRemoved(relayer);
    }

    function setSignatureThreshold(uint256 newThreshold) external onlyOwner {
        signatureThreshold = newThreshold;
        emit SignatureThresholdSet(newThreshold);
    }

    function setGateway(uint256 chainId, address gateway) external onlyOwner {
        gateways[chainId] = gateway;
    }

    function setSupportedToken(address token, bool isSupported, address wrappedToken) external onlyOwner {
        supportedTokens[token] = isSupported;
        if (isSupported) {
            wrappedTokenMap[token] = wrappedToken;
        } else {
            delete wrappedTokenMap[token];
        }
    }

    function sendTokens(address token, uint256 amount, uint256 toChainId) external {
        require(!paused, "Contract paused");
        require(supportedTokens[token], "Token not supported");
        require(gateways[toChainId] != address(0), "Gateway not set");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        emit TokensSent(msg.sender, token, amount, toChainId);
    }

    function sendMessage(bytes calldata payload, uint256 toChainId) external {
        require(!paused, "Contract paused");
        require(gateways[toChainId] != address(0), "Gateway not set");
        emit MessageSent(msg.sender, toChainId, payload);
    }

    function _recoverSigner(bytes32 messageHash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "Invalid signature 'v' value");

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        return ecrecover(ethSignedHash, v, r, s);
    }

    function _verifySignatures(bytes32 messageHash, bytes[] calldata signatures) internal view {
        require(signatures.length >= signatureThreshold, "Not enough signatures");

        address[] memory signers = new address[](signatures.length);
        for (uint i = 0; i < signatures.length; i++) {
            address signer = _recoverSigner(messageHash, signatures[i]);
            require(isRelayer[signer], "Invalid signer");

            for (uint j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate signer");
            }
            signers[i] = signer;
        }
    }

    function receiveTokens(
        address originalSender,
        address originalToken,
        uint256 amount,
        uint256 fromChainId,
        bytes[] calldata signatures
    ) external {
    require(!paused, "Contract paused");
    bytes32 messageHash = keccak256(abi.encodePacked(originalSender, originalToken, amount, fromChainId, "receive"));
        require(!usedSignatures[messageHash], "Signatures already used");

        _verifySignatures(messageHash, signatures);
        usedSignatures[messageHash] = true;

        address wrappedTokenAddress = wrappedTokenMap[originalToken];
        require(wrappedTokenAddress != address(0), "Wrapped token not found");

        WrappedToken(wrappedTokenAddress).mint(originalSender, amount);

        emit TokensReceived(originalSender, originalToken, amount, fromChainId);
    }

    /// Receive tokens using a proof from a light client instead of relayer signatures.
    /// `lightClient` is the address of a contract implementing `ILightClient` that
    /// knows about the source chain's header roots. `headerRoot` identifies the header
    /// and `proof` is an opaque proof blob that the light client can verify.
    function receiveTokensWithProof(
        address originalSender,
        address originalToken,
        uint256 amount,
        uint256 fromChainId,
        bytes32 headerRoot,
        bytes calldata proof,
        address lightClient
    ) external {
        require(!paused, "Contract paused");
        bytes32 messageHash = keccak256(abi.encodePacked(originalSender, originalToken, amount, fromChainId, "receive_proof", headerRoot));
        require(!usedSignatures[messageHash], "Proof already used");

        require(ILightClient(lightClient).verifyProof(headerRoot, proof), "Invalid proof");
        usedSignatures[messageHash] = true;

        address wrappedTokenAddress = wrappedTokenMap[originalToken];
        require(wrappedTokenAddress != address(0), "Wrapped token not found");

        WrappedToken(wrappedTokenAddress).mint(originalSender, amount);

        emit TokensReceived(originalSender, originalToken, amount, fromChainId);
    }

    function releaseTokens(address originalToken, uint256 amount, uint256 toChainId) external {
        require(!paused, "Contract paused");
        require(gateways[toChainId] != address(0), "Gateway not set for destination");

        address wrappedTokenAddress = wrappedTokenMap[originalToken];
        require(wrappedTokenAddress != address(0), "Wrapped token not found for original token");

        WrappedToken(wrappedTokenAddress).burnFrom(msg.sender, amount);

        emit TokensReleased(msg.sender, originalToken, amount, toChainId);
    }

    function unlockTokens(
        address user,
        address originalToken,
        uint256 amount,
        uint256 fromChainId,
        bytes[] calldata signatures
    ) external {
    require(!paused, "Contract paused");
    bytes32 messageHash = keccak256(abi.encodePacked(user, originalToken, amount, fromChainId, "unlock"));
        require(!usedSignatures[messageHash], "Signatures already used");

        _verifySignatures(messageHash, signatures);
        usedSignatures[messageHash] = true;

        require(supportedTokens[originalToken], "Token not supported");

        IERC20(originalToken).transfer(user, amount);

        emit TokensUnlocked(user, originalToken, amount);
    }

    // Generic cross-chain message execution. The relayer network will sign off on
    // the message and any relayer can call this to execute the payload on-chain.
    function receiveMessage(
        address target,
        bytes calldata payload,
        uint256 fromChainId,
        bytes[] calldata signatures
    ) external {
        require(!paused, "Contract paused");
        bytes32 messageHash = keccak256(abi.encodePacked(target, payload, fromChainId, "message"));
        require(!usedSignatures[messageHash], "Signatures already used");

        _verifySignatures(messageHash, signatures);
        usedSignatures[messageHash] = true;

        (bool success, ) = target.call(payload);
        emit MessageReceived(msg.sender, target, fromChainId, payload, success);
    }
}
