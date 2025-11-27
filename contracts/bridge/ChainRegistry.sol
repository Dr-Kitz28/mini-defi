// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ChainRegistry
 * @notice Registry of supported chains, gateway addresses and token allowlists.
 *         Acts as a single source of truth to (a) exclude meme/unsupported chains,
 *         (b) whitelist tokens per destination, and (c) classify chain categories.
 */
contract ChainRegistry is Ownable {
    constructor() Ownable(msg.sender) {}
    enum ChainKind { EVM, UTXO, COSMOS, SUBSTRATE, SOLANA, CARDANO, OTHER }

    struct ChainInfo {
        bool enabled;
        ChainKind kind;
        address gateway; // gateway contract/program address on that chain (EVM address or adapter id)
    }

    // chainId (per chain's native id for EVM; otherwise a project-defined id) => info
    mapping(uint256 => ChainInfo) public chains;

    // token allowlist per chainId => token address => allowed
    mapping(uint256 => mapping(address => bool)) public allowedTokens;

    event ChainSet(uint256 indexed chainId, ChainKind kind, address gateway, bool enabled);
    event TokenAllowed(uint256 indexed chainId, address indexed token, bool allowed);

    function setChain(
        uint256 chainId,
        ChainKind kind,
        address gateway,
        bool enabled
    ) external onlyOwner {
        chains[chainId] = ChainInfo({enabled: enabled, kind: kind, gateway: gateway});
        emit ChainSet(chainId, kind, gateway, enabled);
    }

    function setTokenAllowed(
        uint256 chainId,
        address token,
        bool allowed
    ) external onlyOwner {
        allowedTokens[chainId][token] = allowed;
        emit TokenAllowed(chainId, token, allowed);
    }

    function isChainEnabled(uint256 chainId) external view returns (bool) {
        return chains[chainId].enabled;
    }

    function isTokenAllowed(uint256 chainId, address token) external view returns (bool) {
        return allowedTokens[chainId][token];
    }

    function gatewayFor(uint256 chainId) external view returns (address) {
        return chains[chainId].gateway;
    }

    function kindOf(uint256 chainId) external view returns (ChainKind) {
        return chains[chainId].kind;
    }
}
