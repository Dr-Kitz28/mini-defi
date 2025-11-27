// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RelayerManager
 * @dev Manages the lifecycle of relayers: staking, unstaking, and slashing.
 * This contract holds the list of active relayers for the cross-chain protocol.
 */
contract RelayerManager is Ownable {
    IERC20 public immutable stakingToken;
    uint256 public immutable minStake;

    mapping(address => uint256) public stakes;
    address[] public relayerSet;
    mapping(address => bool) public isRelayer;

    event Staked(address indexed relayer, uint256 amount);
    event Unstaked(address indexed relayer, uint256 amount);
    event Slashed(address indexed relayer, uint256 amount);

    modifier onlyActiveRelayer() {
        require(isRelayer[msg.sender], "Not an active relayer");
        _;
    }

    constructor(address _stakingToken, uint256 _minStake) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid token address");
        require(_minStake > 0, "Minimum stake must be positive");
        stakingToken = IERC20(_stakingToken);
        minStake = _minStake;
    }

    /**
     * @dev Allows an address to stake tokens and become a relayer.
     */
    function stake() external {
        require(!isRelayer[msg.sender], "Already a relayer");

        uint256 allowance = stakingToken.allowance(msg.sender, address(this));
        require(allowance >= minStake, "Insufficient token allowance");

        bool success = stakingToken.transferFrom(msg.sender, address(this), minStake);
        require(success, "Token transfer failed");

        stakes[msg.sender] = minStake;
        isRelayer[msg.sender] = true;
        relayerSet.push(msg.sender);

        emit Staked(msg.sender, minStake);
    }

    /**
     * @dev Allows a relayer to unstake their tokens and cease being a relayer.
     * In a real system, this would likely have a time-lock (unbonding period).
     */
    function unstake() external onlyActiveRelayer {
        uint256 amount = stakes[msg.sender];
        
        // Remove from relayer set
        for (uint i = 0; i < relayerSet.length; i++) {
            if (relayerSet[i] == msg.sender) {
                relayerSet[i] = relayerSet[relayerSet.length - 1];
                relayerSet.pop();
                break;
            }
        }

        isRelayer[msg.sender] = false;
        stakes[msg.sender] = 0;

        bool success = stakingToken.transfer(msg.sender, amount);
        require(success, "Token transfer failed");

        emit Unstaked(msg.sender, amount);
    }

    /**
     * @dev Slashes a relayer's stake for misbehavior. Can only be called by the owner (governance).
     * In a real system, this would be triggered by a fraud proof.
     */
    function slash(address relayer, uint256 amount) external onlyOwner {
        require(isRelayer[relayer], "Address is not a relayer");
        uint256 currentStake = stakes[relayer];
        require(amount <= currentStake, "Slash amount exceeds stake");

        stakes[relayer] -= amount;
        // The slashed tokens are kept in the contract, effectively burned from the relayer's perspective.
        // Governance could decide to move them elsewhere.

        emit Slashed(relayer, amount);
    }

    /**
     * @dev Returns the number of active relayers.
     */
    function getRelayerCount() external view returns (uint256) {
        return relayerSet.length;
    }

    /**
     * @dev Returns the list of all active relayers.
     */
    function getRelayers() external view returns (address[] memory) {
        return relayerSet;
    }

    /**
     * @notice Returns the signature threshold required for quorum.
     * @dev Simple 2/3+1 rule: floor(2*n/3) + 1 to be conservative.
     */
    function signatureThreshold() external view returns (uint256) {
        uint256 n = relayerSet.length;
        if (n == 0) return 0;
        return (n * 2) / 3 + 1;
    }
}
