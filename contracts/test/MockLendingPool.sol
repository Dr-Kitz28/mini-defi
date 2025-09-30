// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";

contract MockLendingPool {
    IInterestRateModel public irm;
    uint256 public currentUtilization;

    function utilization() external view returns (uint256) {
        return currentUtilization;
    }

    function setUtilization(uint256 _utilization) external {
        currentUtilization = _utilization;
    }

    function setIRM(address _irm) external {
        irm = IInterestRateModel(_irm);
    }

    function triggerRateUpdate() external {
        irm.updateBorrowRate(currentUtilization);
    }
}
