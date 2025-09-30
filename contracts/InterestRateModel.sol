// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Extremely simple linear interest rate model: rate = base + slope * utilization
/// - Utilization in 1e18 (e.g., 0.45e18 => 45%)
/// - Returns borrow rate per second in 1e18 (e.g., 0.05e18/year => ~1.58e-9 per second)
contract InterestRateModel {
    uint256 public immutable baseAPR; // e.g., 0.02e18 = 2% APR
    uint256 public immutable slopeAPR; // e.g., 0.20e18 = +20% APR at 100% utilization
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    constructor(uint256 _baseAPR, uint256 _slopeAPR) {
        baseAPR = _baseAPR; // in 1e18
        slopeAPR = _slopeAPR; // in 1e18
    }

    /// @param utilization 1e18 scale (0 to 1e18)
    /// @return ratePerSecond 1e18 scale
    function getBorrowRatePerSecond(
        uint256 utilization
    ) external view returns (uint256) {
        if (utilization > 1e18) utilization = 1e18;
        uint256 apr = baseAPR + (slopeAPR * utilization) / 1e18; // 1e18
        return apr / SECONDS_PER_YEAR; // per-second rate in 1e18
    }
}
