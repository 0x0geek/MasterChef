// Import the required modules
const { WETH } = require("@uniswap/sdk");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { currentBlock, advanceBlockTo } = require("./Time");

const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT_ADDRESS = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const UNISWAP_FACTORY_ADDRESS = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const UNISWAP_ROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

describe("MasterChef", function () {

  // Define variables to store contract instances
  let owner;
  let alice;
  let bob;
  let carol;
  let dev;
  let lpToken;
  let uniswapRouter;
  let usdc;
  let usdt;
  let weth;
  const rewardTokenPerBlocks = [100, 150];
  const pid = 0;
  let lpInitialBalance

  // Deploy the contracts before each test case
  before(async function () {

    [owner, alice, bob, carol, dev] = await ethers.getSigners();

    // Use existing USDC and USDT contracts on the mainnet
    weth = await ethers.getContractAt('IWETH', WETH_ADDRESS);
    usdc = await ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', USDC_ADDRESS); // USDC address on mainnet
    usdt = await ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', USDT_ADDRESS); // USDT address on mainnet

    // Use existing Uniswap router contracts on the mainnet
    uniswapFactory = await ethers.getContractAt(
      'IUniswapV2Factory',
      UNISWAP_FACTORY_ADDRESS
    )
    // Use existing Uniswap router contracts on the mainnet
    uniswapRouter = await ethers.getContractAt(
      'IUniswapV2Router02',
      UNISWAP_ROUTER_ADDRESS
    );

    // Calculate the amount of ETH to convert to USDC
    const ethToConvert = ethers.utils.parseEther("1");

    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
    const pathUSDC = [weth.address, usdc.address];
    const pathUSDT = [weth.address, usdt.address];

    // Alice Call the swapExactETHForTokensUniswap function to get USDC on the Uniswap router contract
    await uniswapRouter.connect(alice).swapExactETHForTokens(0, pathUSDC, alice.address, deadline, { value: ethToConvert });
    await uniswapRouter.connect(alice).swapExactETHForTokens(0, pathUSDT, alice.address, deadline, { value: ethToConvert });

    // Bob Call the swapExactETHForTokensUniswap function to get USDC on the Uniswap router contract
    await uniswapRouter.connect(bob).swapExactETHForTokens(0, pathUSDC, bob.address, deadline, { value: ethToConvert });
    await uniswapRouter.connect(bob).swapExactETHForTokens(0, pathUSDT, bob.address, deadline, { value: ethToConvert });

    // Carol Call the swapExactETHForTokensUniswap function to get USDC on the Uniswap router contract
    await uniswapRouter.connect(carol).swapExactETHForTokens(0, pathUSDC, carol.address, deadline, { value: ethToConvert });
    await uniswapRouter.connect(carol).swapExactETHForTokens(0, pathUSDT, carol.address, deadline, { value: ethToConvert });

    const usdcLiquidityAmount = ethers.utils.parseUnits("3", 6);
    const usdtLiquidityAmount = ethers.utils.parseUnits("4", 6);

    await usdc.connect(alice).approve(uniswapRouter.address, usdcLiquidityAmount);
    await usdt.connect(alice).approve(uniswapRouter.address, usdtLiquidityAmount);

    await usdc.connect(bob).approve(uniswapRouter.address, usdcLiquidityAmount);
    await usdt.connect(bob).approve(uniswapRouter.address, usdtLiquidityAmount);

    await usdc.connect(carol).approve(uniswapRouter.address, usdcLiquidityAmount);
    await usdt.connect(carol).approve(uniswapRouter.address, usdtLiquidityAmount);

    // Add liquidity to Uniswap pool
    await uniswapRouter.connect(alice).addLiquidity(
      usdc.address,
      usdt.address,
      usdcLiquidityAmount,
      usdtLiquidityAmount,
      0,
      0,
      alice.address,
      deadline
    );

    await uniswapRouter.connect(bob).addLiquidity(
      usdc.address,
      usdt.address,
      usdcLiquidityAmount,
      usdtLiquidityAmount,
      0,
      0,
      bob.address,
      deadline
    );

    await uniswapRouter.connect(carol).addLiquidity(
      usdc.address,
      usdt.address,
      usdcLiquidityAmount,
      usdtLiquidityAmount,
      0,
      0,
      carol.address,
      deadline
    );

    // Get the LP token address for the USDC/USDT pair
    const pairAddress = await uniswapFactory.connect(owner).getPair(usdc.address, usdt.address);

    // Get the LP token contract instance
    lpToken = await ethers.getContractAt('IUniswapV2Pair', pairAddress);

    lpInitialBalance = await lpToken.balanceOf(alice.address);
  });

  it("should revert with error message when rewards data is invalid", async function () {

    const startBlock = await currentBlock();
    const bonusEndBlock = startBlock.add(1000);

    const MasterChef = await ethers.getContractFactory("MasterChef");

    // Deploy TokenA and  TokenB as reward token
    const MockRewardToken = await ethers.getContractFactory("MockRewardToken");
    const tokenA = await MockRewardToken.connect(owner).deploy();
    await tokenA.deployed();

    const tokenB = await MockRewardToken.connect(owner).deploy();
    await tokenB.deployed();

    await expect(
      MasterChef.deploy(
        startBlock,
        dev.address,
        [tokenA.address, tokenB.address],
        [10, 20, 30],
        bonusEndBlock)
    ).to.be.revertedWithCustomError(MasterChef, "InvalidRewardData");

  });

  async function deployMasterChefContractWithoutPool() {

    // Deploy TokenA and  TokenB as reward token
    const MockRewardToken = await ethers.getContractFactory("MockRewardToken");
    const tokenA = await MockRewardToken.connect(owner).deploy();
    await tokenA.deployed();

    const tokenB = await MockRewardToken.connect(owner).deploy();
    await tokenB.deployed();

    // Deploy MasterChef contract
    const MasterChef = await ethers.getContractFactory("MasterChef");

    const blockNumber = await currentBlock();

    const startBlock = blockNumber.add(300);
    const bonusEndBlock = blockNumber.add(1000);

    const masterChef = await MasterChef.deploy(
      startBlock,
      dev.address,
      [tokenA.address, tokenB.address],
      rewardTokenPerBlocks,
      bonusEndBlock
    );

    await masterChef.deployed();

    await tokenA.connect(owner).transferOwnership(masterChef.address);
    await tokenB.connect(owner).transferOwnership(masterChef.address);

    return { masterChef, startBlock, tokenA, tokenB, bonusEndBlock };
  }

  async function deployMasterChefContractWithPool() {

    // Deploy TokenA and  TokenB as reward token
    const MockRewardToken = await ethers.getContractFactory("MockRewardToken");
    const tokenA = await MockRewardToken.connect(owner).deploy();
    await tokenA.deployed();

    const tokenB = await MockRewardToken.connect(owner).deploy();
    await tokenB.deployed();

    // Deploy MasterChef contract
    const MasterChef = await ethers.getContractFactory("MasterChef");

    const blockNumber = await currentBlock();

    const startBlock = blockNumber.add(300);
    const bonusEndBlock = blockNumber.add(1000);
    const allocPoint = "100";

    const masterChef = await MasterChef.deploy(
      startBlock,
      dev.address,
      [tokenA.address, tokenB.address],
      rewardTokenPerBlocks,
      bonusEndBlock
    );


    await masterChef.deployed();

    await masterChef.connect(owner).addPool(allocPoint, lpToken.address, true);

    await tokenA.connect(owner).transferOwnership(masterChef.address);
    await tokenB.connect(owner).transferOwnership(masterChef.address);

    return { masterChef, startBlock, allocPoint, tokenA, tokenB, bonusEndBlock };
  }

  describe("Add a new pool to MasterChef", function () {

    it("should add a new pool with earlier date", async function () {

      // Deploy TokenA and  TokenB as reward token
      const MockRewardToken = await ethers.getContractFactory("MockRewardToken");
      const tokenA = await MockRewardToken.connect(owner).deploy();
      await tokenA.deployed();

      const tokenB = await MockRewardToken.connect(owner).deploy();
      await tokenB.deployed();

      // Deploy MasterChef contract
      const MasterChef = await ethers.getContractFactory("MasterChef");

      const blockNumber = await currentBlock();

      const startBlock = blockNumber.sub(300);
      const bonusEndBlock = blockNumber.add(1000);

      const masterChef = await MasterChef.deploy(
        startBlock,
        dev.address,
        [tokenA.address, tokenB.address],
        rewardTokenPerBlocks,
        bonusEndBlock
      );


      await masterChef.deployed();

      await masterChef.connect(owner).addPool("100", lpToken.address, false);

      const poolInfo = await masterChef.poolInfo(pid);

      expect(poolInfo.lpToken).to.equal(lpToken.address);
      expect(poolInfo.allocPoint).to.equal("100");
      expect(await masterChef.totalAllocPoint()).to.equal("100");
    });

    it("should add a new pool successfully", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithoutPool);

      await masterChef.connect(owner).addPool("100", lpToken.address, false);

      const poolInfo = await masterChef.poolInfo(pid);

      expect(poolInfo.lpToken).to.equal(lpToken.address);
      expect(poolInfo.allocPoint).to.equal("100");
      expect(await masterChef.totalAllocPoint()).to.equal("100");
    });

    it("should revert when user is going to add pool", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);

      // Call the function to add the pool and check that it reverts
      await expect(masterChef.connect(alice).addPool(10, lpToken.address, false)).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Set a pool info to MasterChef", function () {

    it("should revert when user is going to set pool", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);

      // Call the function to set the pool
      await expect(masterChef.connect(alice).setPool(pid, 20, false)).to.revertedWith("Ownable: caller is not the owner");
    });

    it("should change pool info with updating pools successfully", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);
      // Call the function to add the pool
      await masterChef.connect(owner).setPool(pid, 20, true);

      // Check that the pool was added with the correct values
      const poolInfo = await masterChef.poolInfo(pid);
      expect(poolInfo.allocPoint).to.equal("20");
    });

    it("should change pool info without updating pools successfully", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);
      // Call the function to add the pool
      await masterChef.connect(owner).setPool(0, 20, false);

      // Check that the pool was added with the correct values
      const poolInfo = await masterChef.poolInfo(0);
      expect(poolInfo.allocPoint).to.equal("20");
    });
  });

  describe("Deposit LP tokens to MasterChef", function () {

    it("should deposit LP tokens and update user info and pool info", async function () {

      const { masterChef, allocPoint } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(alice).approve(masterChef.address, "1000");
      await masterChef.connect(alice).deposit(pid, "100");

      const userInfo = await masterChef.connect(alice).getUserInfo(pid, alice.address);

      expect(userInfo.amount).to.equal("100");
      expect(await lpToken.balanceOf(masterChef.address)).to.equal("100");
    });

  });

  describe("Withdraw LP tokens and receive rewards according to bonusEndBlock", async function () {

    it("should withdraw LP tokens and receive rewards", async function () {

      const { masterChef, tokenA, tokenB, startBlock } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(alice).approve(masterChef.address, "1000");
      await lpToken.connect(bob).approve(masterChef.address, "1000");
      await lpToken.connect(carol).approve(masterChef.address, "1000");

      // Alice deposits 10 LP tokens to pool
      await advanceBlockTo(startBlock.add(309))
      await masterChef.connect(alice).deposit(pid, "10");

      // Bob deposits 20 LP tokens to pool at 
      await advanceBlockTo(startBlock.add(313))
      await masterChef.connect(bob).deposit(pid, "20");

      // Carol deposits 30 LP tokens to pool
      await advanceBlockTo(startBlock.add(pid))
      await masterChef.connect(carol).deposit(pid, "30");

      // Alice deposits 10 LP tokens more
      await advanceBlockTo(startBlock.add(319));
      await masterChef.connect(alice).deposit(pid, "10");

      // TokenA's totalSupply should be 1291 + 0 + 0 + 3709 + 500 = 5500
      expect(await tokenA.totalSupply()).to.equal("5500")
      expect(await tokenA.balanceOf(alice.address)).to.equal("1291")
      expect(await tokenA.balanceOf(bob.address)).to.equal("0")
      expect(await tokenA.balanceOf(carol.address)).to.equal("0")
      expect(await tokenA.balanceOf(masterChef.address)).to.equal("3709")
      expect(await tokenA.balanceOf(dev.address)).to.equal("500")

      // TokenB's totalSupply should be 1937 + 0 + 0 + 5563 + 750 = 8250 
      expect(await tokenB.totalSupply()).to.equal("8250")
      expect(await tokenB.balanceOf(alice.address)).to.equal("1937")
      expect(await tokenB.balanceOf(bob.address)).to.equal("0")
      expect(await tokenB.balanceOf(carol.address)).to.equal("0")
      expect(await tokenB.balanceOf(masterChef.address)).to.equal("5563")
      expect(await tokenB.balanceOf(dev.address)).to.equal("750")

      await advanceBlockTo(startBlock.add(329));
      await masterChef.connect(alice).deposit(pid, "10");
      await masterChef.connect(bob).withdraw(pid, "5");

      // Check TokenA Balance
      expect(await tokenA.totalSupply()).to.equal("11550")
      expect(await tokenA.balanceOf(alice.address)).to.equal("3297")
      expect(await tokenA.balanceOf(bob.address)).to.equal("3360")
      expect(await tokenA.balanceOf(carol.address)).to.equal("0")
      expect(await tokenA.balanceOf(masterChef.address)).to.equal("3843")
      expect(await tokenA.balanceOf(dev.address)).to.equal("1050")

      // Check TokenB Balance
      expect(await tokenB.totalSupply()).to.equal("17325")
      expect(await tokenB.balanceOf(alice.address)).to.equal("4946")
      expect(await tokenB.balanceOf(bob.address)).to.equal("5040")
      expect(await tokenB.balanceOf(carol.address)).to.equal("0")
      expect(await tokenB.balanceOf(masterChef.address)).to.equal("5764")
      expect(await tokenB.balanceOf(dev.address)).to.equal("1575")

      await advanceBlockTo(startBlock.add(339));
      await masterChef.connect(alice).withdraw(pid, "30");
      await advanceBlockTo(startBlock.add(349));
      await masterChef.connect(bob).withdraw(pid, "15");
      await advanceBlockTo(startBlock.add(359));
      await masterChef.connect(carol).withdraw(pid, "30");

      expect(await tokenA.totalSupply()).to.equal("27500");
      expect(await tokenA.balanceOf(alice.address)).to.equal("5940");
      expect(await tokenA.balanceOf(bob.address)).to.equal("4557");
      expect(await tokenA.balanceOf(carol.address)).to.equal("10106");
      expect(await tokenA.balanceOf(masterChef.address)).to.equal("4397");
      expect(await tokenA.balanceOf(dev.address)).to.equal("2500");

      expect(await tokenB.totalSupply()).to.equal("41250");
      expect(await tokenB.balanceOf(alice.address)).to.equal("8910");
      expect(await tokenB.balanceOf(bob.address)).to.equal("6836");
      expect(await tokenB.balanceOf(carol.address)).to.equal("15160");
      expect(await tokenB.balanceOf(masterChef.address)).to.equal("6594");
      expect(await tokenB.balanceOf(dev.address)).to.equal("3750");

      expect(await lpToken.balanceOf(alice.address)).to.equal(lpInitialBalance)
      expect(await lpToken.balanceOf(bob.address)).to.equal(lpInitialBalance)
      expect(await lpToken.balanceOf(carol.address)).to.equal(lpInitialBalance)
    });

    it("should stop giving bonus rewards after the bonus period ends", async function () {

      const { masterChef, startBlock } = await loadFixture(deployMasterChefContractWithPool);

      // 100 per block farming rate starting at block 300 with bonus until block 1000
      await lpToken.connect(alice).approve(masterChef.address, "1000");

      // Alice deposits 10 LPs at block 990
      await advanceBlockTo(startBlock.add(679));
      await masterChef.connect(alice).deposit(pid, "10");

      // At block 995, alice should have 1500 pending.
      await advanceBlockTo(startBlock.add(695));
      await masterChef.connect(alice).deposit(pid, "10");

      await advanceBlockTo(startBlock.add(710));
      await masterChef.connect(alice).withdraw(pid, "20");

      const pendings = await masterChef.connect(alice).pendingRewards(pid, alice.address);
      expect(pendings[pid]).equal("0");
    });


    it("should not give bonus rewards when withdraw after bonus period ends ", async function () {

      const { masterChef, startBlock, tokenA } = await loadFixture(deployMasterChefContractWithPool);

      // 100 per block farming rate starting at block 300 with bonus until block 1000
      await lpToken.connect(alice).approve(masterChef.address, "1000");

      // Alice deposits 10 LPs at block 1019 and withdraw at block 1029, so there is no bonus rewards, because he deposits after bonus period
      await advanceBlockTo(startBlock.add(719));
      await masterChef.connect(alice).deposit(pid, "10");
      await advanceBlockTo(startBlock.add(729));
      await masterChef.connect(alice).withdraw(pid, "10");

      expect(await tokenA.balanceOf(alice.address)).equal("250");
    });

    it("allows emergency withdrawal", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(bob).approve(masterChef.address, "1000");
      await masterChef.connect(bob).deposit(pid, "500")

      // Get LPToken balance before withdrawal
      const lpTokenBalanceBefore = await lpToken.connect(bob).balanceOf(bob.address);

      // Withdraw without rewards
      await masterChef.connect(bob).emergencyWithdraw(pid);

      // Check LP token balance
      expect(await lpToken.connect(bob).balanceOf(bob.address)).to.equal(lpTokenBalanceBefore.add("500"));
    });

    it("should revert if withdraw amount is greater than user's reward amount", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(bob).approve(masterChef.address, "1000");
      await masterChef.connect(bob).deposit(pid, "500")
      await expect(masterChef.connect(bob).withdraw(pid, "600")).to.be.revertedWithCustomError(masterChef, "InsufficientBalance");
    });

  });

  describe("Pending rewards", async function () {

    it("should calculate pending rewards correctly when lpSupply is not zero", async function () {

      const { masterChef, startBlock } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(alice).approve(masterChef.address, "1000");
      await advanceBlockTo(startBlock.add(300));
      await masterChef.connect(alice).deposit(pid, "10");
      await advanceBlockTo(startBlock.add(305));

      const pendings = await masterChef.connect(alice).pendingRewards(pid, alice.address);
      expect(pendings[pid]).equal("2000");
    });
  });


  describe("Claim rewards", async function () {

    it("should claim pending rewards for specified pool and all tokens", async function () {

      const { masterChef, startBlock, tokenA, tokenB } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(alice).approve(masterChef.address, "1000");

      await advanceBlockTo(startBlock.add(300));
      await masterChef.connect(alice).deposit(pid, "10");
      await advanceBlockTo(startBlock.add(305));
      await masterChef.connect(alice).claims(pid);

      expect(await tokenA.balanceOf(alice.address)).to.equal("1250");
      expect(await tokenB.balanceOf(alice.address)).to.equal("1875");
    });

    it("should claim pending rewards for specified pool and specfied tokens", async function () {
      const { masterChef, startBlock, tokenA, tokenB } = await loadFixture(deployMasterChefContractWithPool);

      await lpToken.connect(alice).approve(masterChef.address, "1000");

      await advanceBlockTo(startBlock.add(300));
      await masterChef.connect(alice).deposit(0, "10");
      await advanceBlockTo(startBlock.add(305));
      await masterChef.connect(alice).claim(pid, tokenB.address);
      await masterChef.connect(alice).claim(pid, tokenA.address);

      expect(await tokenB.balanceOf(alice.address)).to.equal("1875");
      expect(await tokenB.balanceOf(alice.address)).to.equal("1875");
      // try to claim invalid token address
      await masterChef.connect(alice).claim(pid, alice.address);
    });

  });

  describe("Other features", async function () {

    it("should revert if caller is not a developer ", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);
      await expect(masterChef.connect(alice).dev(alice.address)).to.be.revertedWithCustomError(masterChef, "UnauthorizedAccess");
    });

    it("should change dev addr if caller is a developer ", async function () {

      const { masterChef } = await loadFixture(deployMasterChefContractWithPool);
      await masterChef.connect(dev).dev(alice.address);
    });
  });

});