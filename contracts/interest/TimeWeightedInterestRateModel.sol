// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IInterestRateModel} from "../interfaces/IInterestRateModel.sol";

/// @notice Adaptive utilization-sensitive rate model inspired by Fraxlend's time-weighted design.
/// @dev The model keeps a mutable APR state that nudges upward when utilization stays above the
///      target band, downward when below, and reverts toward a neutral APR when healthy.
contract TimeWeightedInterestRateModel is Ownable, IInterestRateModel {
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant MAX_ADJUSTMENT_RATE = 5e15; // 0.5% APR change per second at full overshoot

    address public pool; // lending pool allowed to drive updates

    uint256 public minAPR;       // 1e18 annualized APR lower bound
    uint256 public maxAPR;       // 1e18 annualized APR upper bound
    uint256 public neutralAPR;   // 1e18 APR that the system reverts to inside the target band
    uint256 public adjustmentRatePerSecond; // 1e18 APR delta per second at 100% overshoot
    uint256 public lowerUtilization; // 1e18 utilization floor of healthy band
    uint256 public upperUtilization; // 1e18 utilization ceiling of healthy band

    uint256 public currentAPR;   // 1e18 APR that accrues interest
    uint256 public lastUpdate;   // timestamp of latest adjustment

    event PoolConfigured(address indexed pool);
    event ParametersUpdated(
        uint256 minAPR,
        uint256 maxAPR,
        uint256 neutralAPR,
        uint256 adjustmentRatePerSecond,
        uint256 lowerUtilization,
        uint256 upperUtilization
    );
    event RateAdjusted(uint256 utilization, uint256 newAPR, uint256 timestamp);

    error PoolAlreadySet();
    error PoolNotConfigured();
    error UnauthorizedUpdater();
    error InvalidBounds();
    error InvalidAdjustmentRate();

    constructor(
        uint256 _minAPR,
        uint256 _maxAPR,
        uint256 _neutralAPR,
        uint256 _adjustmentRatePerSecond,
        uint256 _lowerUtilization,
        uint256 _upperUtilization,
        address admin
    ) Ownable(admin) {
        _setParameters(
            _minAPR,
            _maxAPR,
            _neutralAPR,
            _adjustmentRatePerSecond,
            _lowerUtilization,
            _upperUtilization
        );
        currentAPR = neutralAPR;
        lastUpdate = block.timestamp;
    }

    /// @notice One-time hook invoked post-deployment to anchor the pool address.
    function setPool(address _pool) external onlyOwner {
        if (pool != address(0)) revert PoolAlreadySet();
        require(_pool != address(0), "pool zero");
        pool = _pool;
        lastUpdate = block.timestamp;
        emit PoolConfigured(_pool);
    }

    function getBorrowRatePerSecond(uint256) external view override returns (uint256) {
        if (currentAPR == 0) return 0;
        return currentAPR / SECONDS_PER_YEAR;
    }

    function updateBorrowRate(uint256) external override {
        if (pool == address(0)) revert PoolNotConfigured();
        if (msg.sender != pool) revert UnauthorizedUpdater();

        uint256 util = ILendingPoolLike(pool).utilization();
        _adjust(util);
    }

    function setParameters(
        uint256 _minAPR,
        uint256 _maxAPR,
        uint256 _neutralAPR,
        uint256 _adjustmentRatePerSecond,
        uint256 _lowerUtilization,
        uint256 _upperUtilization
    ) external onlyOwner {
        _setParameters(
            _minAPR,
            _maxAPR,
            _neutralAPR,
            _adjustmentRatePerSecond,
            _lowerUtilization,
            _upperUtilization
        );

        // Clamp the live APR into the new bounds immediately
        if (currentAPR < minAPR) currentAPR = minAPR;
        if (currentAPR > maxAPR) currentAPR = maxAPR;
    }

    function _adjust(uint256 utilization) internal {
        uint256 previousUpdate = lastUpdate;
        uint256 elapsed = block.timestamp - previousUpdate;
        if (elapsed == 0) return;

        uint256 apr = currentAPR;

        if (utilization > upperUtilization) {
            uint256 overshoot = utilization - upperUtilization;
            uint256 step = (adjustmentRatePerSecond * overshoot) / 1e18;
            uint256 delta = step * elapsed;
            apr += delta;
        } else if (utilization < lowerUtilization) {
            uint256 deficit = lowerUtilization - utilization;
            uint256 step = (adjustmentRatePerSecond * deficit) / 1e18;
            uint256 delta = step * elapsed;
            if (delta >= apr || apr - delta < minAPR) {
                apr = minAPR;
            } else {
                apr -= delta;
            }
        } else {
            if (apr > neutralAPR) {
                uint256 diff = apr - neutralAPR;
                uint256 delta = (adjustmentRatePerSecond * elapsed) / 4;
                if (delta > diff) delta = diff;
                apr -= delta;
            } else if (apr < neutralAPR) {
                uint256 diff = neutralAPR - apr;
                uint256 delta = (adjustmentRatePerSecond * elapsed) / 4;
                if (delta > diff) delta = diff;
                apr += delta;
            }
        }

        if (apr > maxAPR) apr = maxAPR;
        if (apr < minAPR) apr = minAPR;

        currentAPR = apr;
        lastUpdate = block.timestamp;
        emit RateAdjusted(utilization, apr, block.timestamp);
    }

    function _setParameters(
        uint256 _minAPR,
        uint256 _maxAPR,
        uint256 _neutralAPR,
        uint256 _adjustmentRatePerSecond,
        uint256 _lowerUtilization,
        uint256 _upperUtilization
    ) internal {
        if (_minAPR > _maxAPR) revert InvalidBounds();
        if (_neutralAPR < _minAPR || _neutralAPR > _maxAPR) revert InvalidBounds();
        if (_upperUtilization > 1e18 || _lowerUtilization > _upperUtilization) revert InvalidBounds();
        if (_adjustmentRatePerSecond == 0 || _adjustmentRatePerSecond > MAX_ADJUSTMENT_RATE) {
            revert InvalidAdjustmentRate();
        }

        minAPR = _minAPR;
        maxAPR = _maxAPR;
        neutralAPR = _neutralAPR;
        adjustmentRatePerSecond = _adjustmentRatePerSecond;
        lowerUtilization = _lowerUtilization;
        upperUtilization = _upperUtilization;

        emit ParametersUpdated(
            _minAPR,
            _maxAPR,
            _neutralAPR,
            _adjustmentRatePerSecond,
            _lowerUtilization,
            _upperUtilization
        );
    }
}

interface ILendingPoolLike {
    function utilization() external view returns (uint256);
}
