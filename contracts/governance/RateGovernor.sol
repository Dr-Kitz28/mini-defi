// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title RateGovernor
/// @notice Minimal timelocked governance helper for scheduling interest-rate model updates.
/// @dev The governor queues arbitrary calls to interest rate models (or any ownable contract)
///      and executes them after a configurable delay. Designed to own the interest rate
///      strategies so research-driven parameter adjustments can be rolled out safely.
contract RateGovernor is Ownable {

    struct Proposal {
        address target;
        bytes data;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
    }

    uint256 public minDelay; // seconds
    Proposal[] private _proposals;

    event MinDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event UpdateQueued(uint256 indexed proposalId, address indexed target, uint256 executeAfter, bytes data);
    event UpdateExecuted(uint256 indexed proposalId);
    event UpdateCancelled(uint256 indexed proposalId);

    error InvalidTarget();
    error NotReady();
    error AlreadyHandled();

    constructor(uint256 _minDelay, address admin) Ownable(admin) {
        minDelay = _minDelay;
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function setMinDelay(uint256 newDelay) external onlyOwner {
        emit MinDelayUpdated(minDelay, newDelay);
        minDelay = newDelay;
    }

    function queueUpdate(address target, bytes calldata data, uint256 executeAfter)
        external
        onlyOwner
        returns (uint256 proposalId)
    {
        if (target == address(0)) revert InvalidTarget();

        uint256 earliest = block.timestamp + minDelay;
        if (executeAfter < earliest) {
            executeAfter = earliest;
        }

        proposalId = _proposals.length;
        _proposals.push(Proposal({
            target: target,
            data: data,
            executeAfter: executeAfter,
            executed: false,
            cancelled: false
        }));

        emit UpdateQueued(proposalId, target, executeAfter, data);
    }

    function cancel(uint256 proposalId) external onlyOwner {
        Proposal storage proposal = _proposals[proposalId];
        if (proposal.executed || proposal.cancelled) revert AlreadyHandled();
        proposal.cancelled = true;
        emit UpdateCancelled(proposalId);
    }

    function execute(uint256 proposalId) external {
        Proposal storage proposal = _proposals[proposalId];
        if (proposal.executed || proposal.cancelled) revert AlreadyHandled();
        if (block.timestamp < proposal.executeAfter) revert NotReady();

    proposal.executed = true;
    Address.functionCall(proposal.target, proposal.data);

        emit UpdateExecuted(proposalId);
    }
}
