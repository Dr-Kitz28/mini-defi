// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract GlobalRepoRateOracle is Ownable {
    uint256 private repoRate; // Represented as a percentage with 18 decimals, e.g., 5% is 5e16

    event RepoRateUpdated(uint256 newRate);

    constructor(uint256 _initialRate, address admin) Ownable(admin) {
        repoRate = _initialRate;
    }

    function getRepoRate() external view returns (uint256) {
        return repoRate;
    }

    function setRepoRate(uint256 _newRate) external onlyOwner {
        repoRate = _newRate;
        emit RepoRateUpdated(_newRate);
    }
}
