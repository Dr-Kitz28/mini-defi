// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";

/// @notice Exponential model: r(u) = base + coeff * (exp(exponentFactor * u) - 1).
contract ExponentialInterestRateModel is Ownable, IInterestRateModel {
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public baseAPR;         // 1e18
    uint256 public coefficientAPR;  // 1e18 multiplier applied to exp growth
    uint256 public exponentFactor;  // 1e18 (controls curvature)

    event ParamsUpdated(uint256 baseAPR, uint256 coefficientAPR, uint256 exponentFactor);

    constructor(uint256 _baseAPR, uint256 _coefficientAPR, uint256 _exponentFactor, address admin)
        Ownable(admin)
    {
        _setParams(_baseAPR, _coefficientAPR, _exponentFactor);
    }

    function getBorrowRatePerSecond(uint256 utilization) external view override returns (uint256) {
        if (utilization > 1e18) utilization = 1e18;

        // exponentFactor * utilization remains within safe range via parameter bounds
        uint256 exponent = (exponentFactor * utilization) / 1e18;
        uint256 expValue = ExpMath.exp1e18(exponent);
        uint256 apr = baseAPR + (coefficientAPR * (expValue - 1e18)) / 1e18;
        return apr / SECONDS_PER_YEAR;
    }

    function updateBorrowRate(uint256) external pure override {}

    function setParams(uint256 _baseAPR, uint256 _coefficientAPR, uint256 _exponentFactor) external onlyOwner {
        _setParams(_baseAPR, _coefficientAPR, _exponentFactor);
    }

    function _setParams(uint256 _baseAPR, uint256 _coefficientAPR, uint256 _exponentFactor) internal {
        require(_baseAPR <= 1e18, "base too high");
        require(_coefficientAPR <= 10e18, "coeff too high");
        require(_exponentFactor <= 2e18, "exp too high");

        baseAPR = _baseAPR;
        coefficientAPR = _coefficientAPR;
        exponentFactor = _exponentFactor;

        emit ParamsUpdated(_baseAPR, _coefficientAPR, _exponentFactor);
    }
}

library ExpMath {
    uint256 private constant WAD = 1e18;

    /// @notice Approximate e^(x) where x and the result use 1e18 fixed-point decimals.
    /// Uses a 5-term Taylor series which is accurate for x in [0, 2e18].
    function exp1e18(uint256 x) internal pure returns (uint256) {
        require(x <= 2e18, "exp overflow");

        uint256 sum = WAD;
        uint256 term = WAD;

        term = (term * x) / WAD;
        sum += term;

        term = (term * x) / WAD;
        sum += term / 2;

        term = (term * x) / WAD;
        sum += term / 6;

        term = (term * x) / WAD;
        sum += term / 24;

        term = (term * x) / WAD;
        sum += term / 120;

        return sum;
    }
}
