// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library MessageLib {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256(
            "CrossChainMessage(uint256 nonce,uint256 fromChainId,uint256 toChainId,address sender,address target,bytes data,uint256 value)"
        );

    bytes32 internal constant TOKEN_TYPEHASH =
        keccak256(
            "TokenTransfer(uint256 nonce,uint256 fromChainId,uint256 toChainId,address sender,address token,address recipient,uint256 amount)"
        );

    function hashMessage(
        uint256 nonce,
        uint256 fromChainId,
        uint256 toChainId,
        address sender,
        address target,
        bytes memory data,
        uint256 value
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                nonce,
                fromChainId,
                toChainId,
                sender,
                target,
                keccak256(data),
                value
            )
        );
    }

    function hashToken(
        uint256 nonce,
        uint256 fromChainId,
        uint256 toChainId,
        address sender,
        address token,
        address recipient,
        uint256 amount
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TOKEN_TYPEHASH,
                nonce,
                fromChainId,
                toChainId,
                sender,
                token,
                recipient,
                amount
            )
        );
    }
}
