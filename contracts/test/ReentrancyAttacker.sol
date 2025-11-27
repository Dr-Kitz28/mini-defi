// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../LendingPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ReentrancyAttacker {
    LendingPool private immutable pool;
    address private immutable maliciousAsset;
    address private immutable collateralAsset;

    constructor(address _pool, address _maliciousAsset, address _collateralAsset) {
        pool = LendingPool(_pool);
        maliciousAsset = _maliciousAsset;
        collateralAsset = _collateralAsset;
    }

    function deposit(address _token, uint256 _amount) external {
        // First, pull tokens from the original sender to this contract
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);
        // Then, this contract can approve the pool and deposit
        IERC20(_token).approve(address(pool), _amount);
        pool.deposit(_token, _amount);
    }

    function borrow(address _token, uint256 _amount) external {
        pool.borrow(_token, _amount);
    }

    function attack() external {
        // The attack happens by withdrawing the malicious asset, which triggers the re-entrancy
        (uint256 shares, ,) = pool.userAccounts(address(this), maliciousAsset);
        pool.withdraw(maliciousAsset, shares);
    }

    function reenter() external {
        // In the re-entrant call, we attempt to withdraw the clean collateral.
        // This should fail due to the ReentrancyGuard.
        (uint256 shares, ,) = pool.userAccounts(address(this), collateralAsset);
        if (shares > 0) {
            pool.withdraw(collateralAsset, shares); // try to withdraw all shares
        }
    }

    // Fallback function to receive Ether
    receive() external payable {}
    fallback() external payable {}
}
