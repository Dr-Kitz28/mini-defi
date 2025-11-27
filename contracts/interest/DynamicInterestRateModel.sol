// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "../oracles/GlobalRepoRateOracle.sol";

contract DynamicInterestRateModel is IInterestRateModel, Ownable {
    uint256 private constant PRECISION = 1e18;

    GlobalRepoRateOracle public repoRateOracle;
    uint256 public baseRatePerSecond;
    uint256 public utilizationMultiplier;

    event NewParameters(uint256 baseRatePerSecond, uint256 utilizationMultiplier);

    constructor(address _repoRateOracle, uint256 _baseRatePerSecond, uint256 _utilizationMultiplier, address admin) Ownable(admin) {
        repoRateOracle = GlobalRepoRateOracle(_repoRateOracle);
        baseRatePerSecond = _baseRatePerSecond;
        utilizationMultiplier = _utilizationMultiplier;
    }

    function setParameters(uint256 _baseRatePerSecond, uint256 _utilizationMultiplier) external onlyOwner {
        baseRatePerSecond = _baseRatePerSecond;
        utilizationMultiplier = _utilizationMultiplier;
        emit NewParameters(_baseRatePerSecond, _utilizationMultiplier);
    }

    function getBorrowRatePerSecond(uint256 _utilization) external view override returns (uint256) {
        uint256 repoRate = repoRateOracle.getRepoRate();
        uint256 utilizationComponent = (_utilization * utilizationMultiplier) / PRECISION;
        return baseRatePerSecond + utilizationComponent + repoRate;
    }

    function updateBorrowRate(uint256 /*utilization*/) external override {
        // This model's rate is purely dynamic based on view functions,
        // so there is no state to update here.
    }
}
