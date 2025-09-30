// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LendingPool.sol";
import "./interfaces/IInterestRateModel.sol";

error PoolAlreadyExists();

/// @notice Factory that deploys lending pools.
contract LendingPoolFactory {
    mapping(address => address) public getPool;

    event PoolCreated(
        address indexed asset,
        address pool,
        address interestRateModel
    );

    /**
     * @notice Deploys a new LendingPool.
     * @param asset The token that will be lent out and borrowed.
     * @param interestRateModel The address of the interest rate model contract.
     * @return pool The address of the newly created lending pool.
     */
    function createPool(
        address asset,
        address interestRateModel
    ) external returns (address pool) {
        if (getPool[asset] != address(0)) {
            revert PoolAlreadyExists();
        }

        LendingPool newPool = new LendingPool(
            asset,
            interestRateModel
        );
        pool = address(newPool);
        getPool[asset] = pool;
        emit PoolCreated(
            asset,
            pool,
            interestRateModel
        );
    }
}

