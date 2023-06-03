// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const { ethers } = require("hardhat");
const { currentBlock } = require("../test/Time");

async function main() {

  const rewardTokenPerBlocks = [100, 150];
  const [owner] = await ethers.getSigners();

  // Deploy TokenA and  TokenB as reward token
  const MockRewardToken = await ethers.getContractFactory("MockRewardToken");
  const tokenA = await MockRewardToken.deploy();
  await tokenA.deployed();

  const tokenB = await MockRewardToken.deploy();
  await tokenB.deployed();

  // Deploy MasterChef contract
  const MasterChef = await ethers.getContractFactory("MasterChef");

  const startBlock = await currentBlock();
  const bonusEndBlock = startBlock.add(100);

  const masterChef = await MasterChef.deploy(
    startBlock,
    owner.address,
    [tokenA.address, tokenB.address],
    rewardTokenPerBlocks,
    bonusEndBlock
  );

  await masterChef.deployed();

  await tokenA.connect(owner).transferOwnership(masterChef.address);
  await tokenB.connect(owner).transferOwnership(masterChef.address);

  console.log(
    `MasterChef contract deployed to ${masterChef.address}`
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
