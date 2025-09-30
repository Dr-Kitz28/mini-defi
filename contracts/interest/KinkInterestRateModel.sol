// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";

/// @notice Piecewise linear "jump rate" model similar to Compound's IRM.
contract KinkInterestRateModel is Ownable, IInterestRateModel {
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public baseAPR;    // 1e18
    uint256 public slopeLowAPR; // 1e18
    uint256 public slopeHighAPR; // 1e18
    uint256 public kink; // utilization in 1e18

    event ParamsUpdated(uint256 baseAPR, uint256 slopeLowAPR, uint256 slopeHighAPR, uint256 kink);

    constructor(
        uint256 _baseAPR,
        uint256 _slopeLowAPR,
        uint256 _slopeHighAPR,
        uint256 _kink,
        address admin
    ) Ownable(admin) {
        _setParams(_baseAPR, _slopeLowAPR, _slopeHighAPR, _kink);
    }

    function getBorrowRatePerSecond(uint256 utilization) external view override returns (uint256) {
        if (utilization > 1e18) utilization = 1e18;

        uint256 apr;
        if (utilization <= kink) {
            apr = baseAPR + (slopeLowAPR * utilization) / 1e18;
        } else {
            uint256 head = baseAPR + (slopeLowAPR * kink) / 1e18;
            uint256 tail = (slopeHighAPR * (utilization - kink)) / 1e18;
            apr = head + tail;
        }
        return apr / SECONDS_PER_YEAR;
    }

    function updateBorrowRate(uint256) external pure override {}

    function setParams(
        uint256 _baseAPR,
        uint256 _slopeLowAPR,
        uint256 _slopeHighAPR,
        uint256 _kink
    ) external onlyOwner {
        _setParams(_baseAPR, _slopeLowAPR, _slopeHighAPR, _kink);
    }

    function _setParams(
        uint256 _baseAPR,
        uint256 _slopeLowAPR,
        uint256 _slopeHighAPR,
        uint256 _kink
    ) internal {
        require(_kink <= 1e18, "kink too high");
        require(_baseAPR <= 1e18, "base too high");
        require(_slopeLowAPR <= 5e18, "slope1 too high");
        require(_slopeHighAPR <= 10e18, "slope2 too high");

        baseAPR = _baseAPR;
        slopeLowAPR = _slopeLowAPR;
        slopeHighAPR = _slopeHighAPR;
        kink = _kink;

        emit ParamsUpdated(_baseAPR, _slopeLowAPR, _slopeHighAPR, _kink);
    }
}
