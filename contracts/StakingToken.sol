// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StakingToken
 * @dev A simple ERC20 token for staking purposes in the demo.
 * In a real system, this would be a valuable asset like ETH, USDC, or a native protocol token.
 */
contract StakingToken is ERC20, Ownable {
    constructor() ERC20("Staking Token", "STK") Ownable(msg.sender) {}

    /**
     * @dev Mints tokens to a specified address. Can only be called by the owner.
     * This is for demonstration purposes to distribute staking tokens.
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
