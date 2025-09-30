// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInterestRateModel {
    function getBorrowRatePerSecond(uint256 utilization) external view returns (uint256);

    /// @notice Hook that allows the model to update internal state before the latest rate query.
    /// @dev Implementations that do not require mutable state may simply no-op.
    function updateBorrowRate(uint256 utilization) external;
}
