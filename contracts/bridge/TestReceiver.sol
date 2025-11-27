// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TestReceiver {
    uint256 public value;

    event Received(address indexed sender, uint256 value);

    function increment(uint256 by) external returns (uint256) {
        value += by;
        emit Received(msg.sender, by);
        return value;
    }
}
