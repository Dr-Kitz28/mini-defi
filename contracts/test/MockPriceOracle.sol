// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/**
 * @title MockPriceOracle
 * @notice A mock price oracle for testing purposes.
 * Prices can be set by the owner for different assets.
 */
contract MockPriceOracle is Ownable, IPriceOracle {
    mapping(address => uint256) private _prices;
    uint8 private constant PRICE_DECIMALS = 8;

    event PriceUpdated(address indexed asset, uint256 price);

    constructor(address admin) Ownable(admin) {}

    /**
     * @notice Sets the price for a given asset.
     * @param asset The address of the asset.
     * @param price The price to set, scaled by 1e8.
     */
    function setPrice(address asset, uint256 price) external onlyOwner {
        _prices[asset] = price;
        emit PriceUpdated(asset, price);
    }

    /**
     * @notice Returns the price of a specific asset.
     * @param asset The address of the asset's ERC20 contract.
     * @return The price of the asset, scaled by 1e8.
     */
    function getPrice(address asset) external view override returns (uint256) {
        uint256 price = _prices[asset];
        if (price == 0) {
            revert("Price not set for this asset");
        }
        return price;
    }

    /**
     * @notice Returns the number of decimals used for the price.
     */
    function decimals() external pure override returns (uint8) {
        return PRICE_DECIMALS;
    }
}
