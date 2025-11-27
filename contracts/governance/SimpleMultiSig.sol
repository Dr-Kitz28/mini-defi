// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleMultiSig {
    address[] public owners;
    uint256 public required;
    mapping(address => bool) public isOwner;

    event Submit(address indexed proposer, uint256 indexed txId);
    event Confirm(address indexed owner, uint256 indexed txId);
    event Revoke(address indexed owner, uint256 indexed txId);
    event Execute(address indexed executor, uint256 indexed txId);

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "owners required");
        require(_required > 0 && _required <= _owners.length, "invalid required");
        for (uint i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            require(o != address(0), "invalid owner");
            require(!isOwner[o], "owner not unique");
            isOwner[o] = true;
            owners.push(o);
        }
        required = _required;
    }

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        transactions.push(Transaction({to: to, value: value, data: data, executed: false, confirmations: 0}));
        uint256 txId = transactions.length - 1;
        emit Submit(msg.sender, txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(txId < transactions.length, "tx not found");
        require(!confirmations[txId][msg.sender], "already confirmed");
        confirmations[txId][msg.sender] = true;
        transactions[txId].confirmations += 1;
        emit Confirm(msg.sender, txId);
    }

    function executeTransaction(uint256 txId) external onlyOwner {
        Transaction storage t = transactions[txId];
        require(!t.executed, "already executed");
        require(t.confirmations >= required, "not enough confirmations");
        t.executed = true;
        (bool success, ) = t.to.call{value: t.value}(t.data);
        require(success, "tx failed");
        emit Execute(msg.sender, txId);
    }

    receive() external payable {}
}
