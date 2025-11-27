// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPriceOracle
 * @notice Interface for a price oracle that provides the price of an asset in terms of a base currency (e.g., USD).
 * Prices are returned with a fixed number of decimals.
 */
interface IPriceOracle {
    /**
     * @notice Returns the price of a specific asset.
     * @param asset The address of the asset's ERC20 contract.
     * @return The price of the asset, scaled by 1e8 (e.g., a price of $123.45 is returned as 12345000000).
     */
    function getPrice(address asset) external view returns (uint256);

    /**
     * @notice Returns the number of decimals used for the price.
     */
    function decimals() external view returns (uint8);
}
