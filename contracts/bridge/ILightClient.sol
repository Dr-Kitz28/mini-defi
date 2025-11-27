// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILightClient {
    /// @notice Submit a signed checkpoint or header from the source chain.
    /// @dev Implementation may require validator signatures and will store a mapping from blockNumber -> headerRoot.
    function submitCheckpoint(bytes calldata headerOrCheckpoint, bytes[] calldata signatures) external;

    /// @notice Verify a merkle proof against a previously submitted checkpoint/header root.
    /// @return true if proof verifies against a known header root.
    function verifyProof(bytes32 headerRoot, bytes calldata proof) external view returns (bool);

    /// @notice Get the latest known header root
    function latestHeaderRoot() external view returns (bytes32);
}
