// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ILightClient} from "./ILightClient.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Very small reference LightClient that accepts checkpoints (opaque bytes)
 * and exposes a verifyProof method. This is intentionally minimal and meant
 * for testing / prototyping only.
 */
contract LightClientCheckpoint is ILightClient, Ownable {
    constructor() Ownable(msg.sender) {}
    mapping(bytes32 => bool) public accepted;
    bytes32 public latestRoot;

    event CheckpointSubmitted(bytes32 indexed root, address indexed submitter);

    function submitCheckpoint(bytes calldata headerOrCheckpoint, bytes[] calldata /* signatures */) external onlyOwner {
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
