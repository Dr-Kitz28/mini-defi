// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ILightClient} from "./ILightClient.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice A slightly more advanced prototype that stores a set of validator addresses.
 * Any validator can submit a checkpoint; the contract records submitted roots.
 */
contract LightClientValidators is ILightClient, Ownable {
    constructor() Ownable(msg.sender) {}
    mapping(address => bool) public isValidator;
    mapping(bytes32 => bool) public accepted;
    bytes32 public latestRoot;

    event ValidatorAdded(address indexed v);
    event ValidatorRemoved(address indexed v);
    event CheckpointSubmitted(bytes32 indexed root, address indexed submitter);

    function addValidator(address v) external onlyOwner {
        isValidator[v] = true;
        emit ValidatorAdded(v);
    }

    function removeValidator(address v) external onlyOwner {
        isValidator[v] = false;
        emit ValidatorRemoved(v);
    }

    function submitCheckpoint(bytes calldata headerOrCheckpoint, bytes[] calldata /* signatures */) external {
        require(isValidator[msg.sender], "not validator");
        bytes32 root = keccak256(headerOrCheckpoint);
        accepted[root] = true;
        latestRoot = root;
        emit CheckpointSubmitted(root, msg.sender);
    }

    function verifyProof(bytes32 headerRoot, bytes calldata /* proof */) external view returns (bool) {
        return accepted[headerRoot];
    }

    function latestHeaderRoot() external view returns (bytes32) {
        return latestRoot;
    }
}
