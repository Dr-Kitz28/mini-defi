// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";

/// @notice Linear rate model: r(u) = base + slope * u
contract LinearInterestRateModel is Ownable, IInterestRateModel {
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public baseAPR;   // 1e18 scale
    uint256 public slopeAPR;  // 1e18 scale

    event APRUpdated(uint256 oldBaseAPR, uint256 oldSlopeAPR, uint256 newBaseAPR, uint256 newSlopeAPR);

    constructor(uint256 _baseAPR, uint256 _slopeAPR, address admin) Ownable(admin) {
        _setAPR(_baseAPR, _slopeAPR);
    }

    function getBorrowRatePerSecond(uint256 utilization) external view override returns (uint256) {
        if (utilization > 1e18) utilization = 1e18;
        uint256 apr = baseAPR + (slopeAPR * utilization) / 1e18;
        return apr / SECONDS_PER_YEAR;
    }

    function updateBorrowRate(uint256) external pure override {}

    function setAPR(uint256 _baseAPR, uint256 _slopeAPR) external onlyOwner {
        _setAPR(_baseAPR, _slopeAPR);
    }

    function _setAPR(uint256 _baseAPR, uint256 _slopeAPR) internal {
        require(_baseAPR <= 1e18, "base too high");
        require(_slopeAPR <= 5e18, "slope too high");
        emit APRUpdated(baseAPR, slopeAPR, _baseAPR, _slopeAPR);
        baseAPR = _baseAPR;
        slopeAPR = _slopeAPR;
    }
}
