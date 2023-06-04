// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "./MockRewardToken.sol";

interface IMigratorChef {
    // Perform LP token migration from legacy UniswapV2 to SushiSwap.
    // Take the current LP token address and return the new LP token address.
    // Migrator should have full access to the caller's LP token.
    // Return the new LP token address.
    //
    // XXX Migrator must have allowance access to UniswapV2 LP tokens.
    // SushiSwap must mint EXACTLY the same amount of SushiSwap LP tokens or
    // else something bad will happen. Traditional UniswapV2 does not
    // do that so be careful!
    function migrate(IERC20 token) external returns (IERC20);
}

// MasterChef is the master of Sushi. He can make Sushi and he is a fair guy.
//
// Note that it's ownable and the owner wields tremendous power. The ownership
// will be transferred to a governance smart contract once SUSHI is sufficiently
// distributed and the community can show to govern itself.
//
// Have fun reading it. Hopefully it's bug-free. God bless.
contract MasterChef is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256[] rewardDebts; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of SUSHIs
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accRewardPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accRewardPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken; // Address of LP token contract.
        uint256 allocPoint; // How many allocation points assigned to this pool. SUSHIs to distribute per block.
        uint256[] lastRewardBlocks; // Last block number that SUSHIs distribution occurs.
        uint256[] accRewardPerShares; // Accumulated SUSHIs per share, times 1e12. See below.
        IERC20[] rewardTokens;
        uint256[] rewardTokenPerBlocks;
    }

    IERC20[] rewardTokens;
    uint256[] rewardTokenPerBlocks;

    // Dev address.
    address public devaddr;
    // Block number when bonus SUSHI period ends.
    uint256 public bonusEndBlock;
    // SUSHI tokens created per block.
    uint256 public rewardPerBlock;
    // Bonus muliplier for early rewardToken makers.
    uint256 public constant BONUS_MULTIPLIER = 10;
    // The migrator contract. It has a lot of power. Can only be set through governance (owner).
    IMigratorChef public migrator;
    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;
    // The block number when SUSHI mining starts.
    uint256 public startBlock;
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Claim(address indexed user, uint256 indexed pid, address token);
    event Claims(address indexed user, uint256 indexed pid);

    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed pid,
        uint256 amount
    );

    error InvalidRewardData();
    error InsufficientBalance(uint256 available, uint256 requested);
    error UnauthorizedAccess(string message);

    /**
     * @notice Contract constructor that initializes the MasterChef contract with the specified parameters
     * @param _startBlock The block number at which the reward distribution starts
     * @param _devaddr The address to receive developer rewards
     * @param _rewardTokens An array of IERC20 tokens used as rewards for staking
     * @param _rewardTokenPerBlocks An array of reward amounts per block for each corresponding `_rewardToken`
     * @param _bonusEndBlock The block number at which the bonus period ends
     * @dev The constructor checks that the length of the `_rewardTokens` and `_rewardTokenPerBlocks`
     *      arrays match before proceeding. It then sets the contract variables to their initial values,
     *      including the start block, end block, reward tokens, reward amounts, and developer address.
     */
    constructor(
        uint256 _startBlock,
        address _devaddr,
        IERC20[] memory _rewardTokens,
        uint256[] memory _rewardTokenPerBlocks,
        uint256 _bonusEndBlock
    ) public {
        if ((_rewardTokens.length == 0 || _rewardTokenPerBlocks.length == 0) || (_rewardTokens.length != _rewardTokenPerBlocks.length))
            revert InvalidRewardData();

        devaddr = _devaddr;
        rewardTokens = _rewardTokens;
        rewardTokenPerBlocks = _rewardTokenPerBlocks;
        bonusEndBlock = _bonusEndBlock;
        startBlock = _startBlock;
    }

    function getUserInfo(
        uint256 _pid,
        address _user
    ) external view returns (UserInfo memory) {
        return userInfo[_pid][_user];
    }

    /**
     * @notice Add a new pool to the MasterChef contract
     * @param _allocPoint The allocation points assigned to the new pool. This determines its share
     *      of the total rewards distributed by the contract.
     * @param _lpToken The LP token contract address representing the new pool
     * @param _withUpdate A boolean indicating whether to update all existing pools before adding the
     *      new one, to ensure that all reward calculations are up-to-date.
     * @dev If `_withUpdate` is true, the function first calls the `massUpdatePools` method to update
     *      all the existing pools before proceeding.
     * @dev The function then creates a new `PoolInfo` struct representing the new pool, initializes
     *      its `lastRewardBlocks` and `accRewardPerShares` arrays, and adds it to the `poolInfo`
     *      array using the `push` method.
     * @dev Finally, the function updates the `totalAllocPoint` variable to reflect the new pool's
     *      allocation points.
     * @dev Emits a `AddPool` event with the new pool's information as parameters.
     * @notice DO NOT add the same LP token more than once. Rewards will be messed up if you do.
     */
    function addPool(
        uint256 _allocPoint,
        IERC20 _lpToken,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }

        uint256[] memory _lastRewardBlocks = new uint256[](rewardTokens.length);
        uint256[] memory _accRewardPerShares = new uint256[](
            rewardTokens.length
        );

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            _accRewardPerShares[i] = 0;
            _lastRewardBlocks[i] = block.number > startBlock
                ? block.number
                : startBlock;
        }

        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(
            PoolInfo({
                lpToken: _lpToken,
                allocPoint: _allocPoint,
                lastRewardBlocks: _lastRewardBlocks,
                accRewardPerShares: _accRewardPerShares,
                rewardTokens: rewardTokens,
                rewardTokenPerBlocks: rewardTokenPerBlocks
            })
        );
    }

    // Update the given pool's SUSHI allocation point. Can only be called by the owner.
    function setPool(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(
            _allocPoint
        );
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    // // Set the migrator contract. Can only be called by the owner.
    // function setMigrator(IMigratorChef _migrator) public onlyOwner {
    //     migrator = _migrator;
    // }

    // // Migrate lp token to another lp contract. Can be called by anyone. We trust that migrator contract is good.
    // function migrate(uint256 _pid) public {
    //     require(address(migrator) != address(0), "migrate: no migrator");
    //     PoolInfo storage pool = poolInfo[_pid];
    //     IERC20 lpToken = pool.lpToken;
    //     uint256 bal = lpToken.balanceOf(address(this));
    //     lpToken.safeApprove(address(migrator), bal);
    //     IERC20 newLpToken = migrator.migrate(lpToken);
    //     require(bal == newLpToken.balanceOf(address(this)), "migrate: bad");
    //     pool.lpToken = newLpToken;
    // }

    /**
     * @notice Calculate and return the reward multiplier for a given time interval
     * @param _from The starting block number of the interval
     * @param _to The ending block number of the interval
     * @return A uint256 representing the reward multiplier for the interval
     * @dev The function checks if the `_to` block number is before, during, or after the bonus period
     *      to determine the reward multiplier. If the entire interval falls within the bonus period,
     *      it returns the product of the interval length and the `BONUS_MULTIPLIER` constant. If the
     *      entire interval falls outside of the bonus period, the reward multiplier is 1. Otherwise,
     *      the function calculates the reward multiplier for each portion of the interval that falls
     *      inside or outside of the bonus period, and combines them using addition and multiplication.
     */
    function getMultiplier(
        uint256 _from,
        uint256 _to
    ) public view returns (uint256) {
        if (_to <= bonusEndBlock) {
            return _to.sub(_from).mul(BONUS_MULTIPLIER);
        } else if (_from >= bonusEndBlock) {
            return _to.sub(_from);
        } else {
            return
                bonusEndBlock.sub(_from).mul(BONUS_MULTIPLIER).add(
                    _to.sub(bonusEndBlock)
                );
        }
    }

    /**
     * @notice Calculate and return the pending rewards for a user in a given pool
     * @param _pid The ID of the pool to check
     * @param _user The address of the user to calculate rewards for
     * @return An array of uint256 values representing the pending rewards for each supported reward token
     * @dev It gets the current accumulated reward per share value for each reward token,
     *      as well as the total LP token supply for the pool.
     * @dev For each reward token, the function checks if the block number is greater than the last reward block,
     *      and if so, calculates the reward based on the elapsed time and allocation points of the pool.
     *      It then updates the accumulated reward per share value accordingly.
     * @dev Finally, the function calculates the pending rewards for the user by subtracting their reward debt
     *      from their share of the accumulated rewards. It stores these values in the `pendings` array and returns it.
     * @dev Note that if the user does not have any tokens staked in the pool, their pending reward for that token
     *      will be zero.
     */
    function pendingRewards(
        uint256 _pid,
        address _user
    ) external view returns (uint256[] memory) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerShare = 0;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));

        uint256[] memory pendings = new uint256[](pool.rewardTokens.length);

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            pendings[i] = 0;
            accRewardPerShare = pool.accRewardPerShares[i];

            if (block.number > pool.lastRewardBlocks[i] && lpSupply != 0) {
                uint256 multiplier = getMultiplier(
                    pool.lastRewardBlocks[i],
                    block.number
                );

                uint256 reward = multiplier
                    .mul(pool.rewardTokenPerBlocks[i])
                    .mul(pool.allocPoint)
                    .div(totalAllocPoint);
                accRewardPerShare = accRewardPerShare.add(
                    reward.mul(1e12).div(lpSupply)
                );
            }

            if (user.amount > 0) {
                pendings[i] = user
                    .amount
                    .div(pool.rewardTokens.length)
                    .mul(accRewardPerShare)
                    .div(1e12)
                    .sub(user.rewardDebts[i]);
            } else {
                pendings[i] = 0;
            }
        }

        return pendings;
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];

        uint256 multiplier = 0;
        uint256 reward = 0;
        uint256 lpSupply = 0;

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            if (block.number <= pool.lastRewardBlocks[i]) {
                continue;
            }

            lpSupply = pool.lpToken.balanceOf(address(this));
            if (lpSupply == 0) {
                pool.lastRewardBlocks[i] = block.number;
                continue;
            }

            multiplier = getMultiplier(pool.lastRewardBlocks[i], block.number);

            reward = multiplier
                .div(pool.rewardTokens.length)
                .mul(pool.rewardTokenPerBlocks[i])
                .mul(pool.allocPoint)
                .div(totalAllocPoint);

            MockRewardToken token = MockRewardToken(
                address(pool.rewardTokens[i])
            );

            token.mint(devaddr, reward.div(10));
            token.mint(address(this), reward);

            pool.accRewardPerShares[i] = pool.accRewardPerShares[i].add(
                reward.mul(1e12).div(lpSupply)
            );

            pool.lastRewardBlocks[i] = block.number;
        }
    }

    /**
     * @notice Deposit LP tokens into a specific pool and claim pending rewards
     * @param _pid The ID of the pool to deposit into
     * @param _amount The amount of LP tokens to deposit
     * @dev Before depositing, the function updates the pool information to ensure that
     *      all the reward calculations are up-to-date.
     * @dev If the user has deposited LP tokens before, the function calculates any pending rewards
     *      for each supported reward token and transfers them safely to the user using the
     *      `safeRewardTransfer` function. Note that the reward amounts are calculated based on
     *      the user's stake in the pool and the current reward per share values for each token.
     * @dev After processing the rewards, the function updates the user's reward debt for each token,
     *      which takes into account the newly deposited amount of LP tokens.
     * @dev Finally, the function transfers the specified `_amount` of LP tokens from the user's
     *      address to the contract's address and updates the user's balance accordingly.
     * @dev Emits a `Deposit` event with the user's address, the pool ID, and the amount of LP tokens
     *      deposited as parameters.
     */
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            if (user.amount > 0) {
                uint256 pending = user
                    .amount
                    .div(pool.rewardTokens.length)
                    .mul(pool.accRewardPerShares[i])
                    .div(1e12)
                    .sub(user.rewardDebts[i]);
                safeRewardTransfer(pool.rewardTokens[i], msg.sender, pending);

                user.rewardDebts[i] = user
                    .amount
                    .div(pool.rewardTokens.length)
                    .mul(pool.accRewardPerShares[i])
                    .div(1e12);
            } else {
                user.rewardDebts = new uint256[](pool.rewardTokens.length);
                break;
            }
        }

        pool.lpToken.safeTransferFrom(
            address(msg.sender),
            address(this),
            _amount
        );
        user.amount = user.amount.add(_amount);

        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @notice Claim pending rewards for a specific pool and all the tokens it supports
     * @param _pid The pool ID to claim rewards from
     * @dev Before claiming the rewards, the function updates the pool information to ensure that
     *      all the reward calculations are up-to-date.
     * @dev For each reward token in the pool, the function calculates the pending reward amount for
     *      the caller and transfers it safely using the `safeRewardTransfer` function. It also updates
     *      the user's reward debt for that token to reflect the new amount of staked LP tokens.
     * @dev Finally, the function transfers the LP tokens back to the user, which effectively unstakes
     *      them from the pool.
     * @dev Emits a `Claims` event with the user's address and the pool ID as parameters.
     */
    function claims(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            uint256 pending = user
                .amount
                .div(pool.rewardTokens.length)
                .mul(pool.accRewardPerShares[i])
                .div(1e12)
                .sub(user.rewardDebts[i]);
            safeRewardTransfer(pool.rewardTokens[i], msg.sender, pending);
            user.rewardDebts[i] = user
                .amount
                .div(pool.rewardTokens.length)
                .mul(pool.accRewardPerShares[i])
                .div(1e12);
        }

        pool.lpToken.safeTransfer(address(msg.sender), user.amount);

        emit Claims(msg.sender, _pid);
    }

    /**
     * @notice Claim pending rewards for a specific pool and token
     * @param _pid The ID of the pool to claim rewards from
     * @param _rewardToken The address of the reward token to claim rewards in
     * @dev Before claiming the rewards, the function updates the pool information to ensure that
     *      all the reward calculations are up-to-date.
     * @dev If the specified `_rewardToken` is found in the pool's list of supported reward tokens,
     *      the function calculates the user's pending reward amount for that token, transfers the
     *      reward token safely using the `safeRewardTransfer` function, and updates the user's
     *      reward debt for that token. Note that the reward amounts are calculated based on the
     *      user's stake in the pool and the current reward per share values for the token.
     */
    function claim(uint256 _pid, address _rewardToken) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);

        uint256 pending = 0;

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            if (address(pool.rewardTokens[i]) == _rewardToken) {
                pending = user
                    .amount
                    .div(pool.rewardTokens.length)
                    .mul(pool.accRewardPerShares[i])
                    .div(1e12)
                    .sub(user.rewardDebts[i]);
                safeRewardTransfer(pool.rewardTokens[i], msg.sender, pending);
                user.rewardDebts[i] = user
                    .amount
                    .div(pool.rewardTokens.length)
                    .mul(pool.accRewardPerShares[i])
                    .div(1e12);
                break;
            }
        }

        emit Claim(msg.sender, _pid, _rewardToken);
    }

    /**
     * @notice Withdraw LP tokens from a specific pool and claim pending rewards
     * @param _pid The ID of the pool to withdraw from
     * @param _amount The amount of LP tokens to withdraw
     * @dev Before withdrawing, the function updates the pool information to ensure that
     *      all the reward calculations are up-to-date.
     * @dev If the user has enough LP tokens to withdraw (`_amount`), the function calculates any
     *      pending rewards for each supported reward token and transfers them safely to the user
     *      using the `safeRewardTransfer` function. Note that the reward amounts are calculated
     *      based on the user's stake in the pool and the current reward per share values for
     *      each token.
     * @dev After processing the rewards, the function updates the user's reward debt for each token,
     *      which takes into account the withdrawn amount of LP tokens.
     * @dev Finally, the function transfers the specified `_amount` of LP tokens back to the user and
     *      updates their balance accordingly.
     * @dev Emits a `Withdraw` event with the user's address, the pool ID, and the amount of LP tokens
     *      withdrawn as parameters.
     * @dev Throws an error if the user does not have enough LP tokens to withdraw.
     */
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        if (user.amount < _amount)
            revert InsufficientBalance({
                available: user.amount,
                requested: _amount
            });

        updatePool(_pid);

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            if (user.amount > 0) {
                uint256 pending = user
                    .amount
                    .div(pool.rewardTokens.length)
                    .mul(pool.accRewardPerShares[i])
                    .div(1e12)
                    .sub(user.rewardDebts[i]);
                safeRewardTransfer(pool.rewardTokens[i], msg.sender, pending);
            }

            user.rewardDebts[i] = user
                .amount
                .sub(_amount)
                .div(pool.rewardTokens.length)
                .mul(pool.accRewardPerShares[i])
                .div(1e12);
        }

        pool.lpToken.safeTransfer(address(msg.sender), _amount);
        user.amount = user.amount.sub(_amount);

        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.lpToken.safeTransfer(address(msg.sender), user.amount);

        user.amount = 0;

        for (uint256 i = 0; i < pool.rewardTokens.length; i++) {
            user.rewardDebts[i] = 0;
        }

        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
    }

    // Update dev address by the previous dev.
    function dev(address _devaddr) public {
        if (msg.sender != devaddr) {
            revert UnauthorizedAccess(
                "Only the previous developer can update the dev address"
            );
        }
        devaddr = _devaddr;
    }

    // Safe rewardToken transfer function, just in case if rounding error causes pool to not have enough SUSHIs.
    function safeRewardTransfer(
        IERC20 _token,
        address _to,
        uint256 _amount
    ) internal {
        uint256 balance = _token.balanceOf(address(this));
        if (_amount > balance) {
            _token.transfer(_to, balance);
        } else {
            _token.transfer(_to, _amount);
        }
    }
}
