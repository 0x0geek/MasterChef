const { ethers } = require("hardhat");

const { BigNumber } = ethers;

async function advanceBlock() {
    await ethers.provider.send('evm_mine');
}

async function currentBlock() {
    const blockNum = await ethers.provider.getBlockNumber();
    return BigNumber.from(blockNum);
}

async function advanceBlockTo(blockNumber) {
    const currentBlockNumber = await ethers.provider.getBlockNumber();

    for (let i = currentBlockNumber; i < blockNumber; i++) {
        await advanceBlock();
    }
}

async function increase(time) {
    await ethers.provider.send("evm_increaseTime", [time.toNumber()]);
    await advanceBlock();
}

async function latest() {
    const block = await ethers.provider.getBlock("latest");
    return BigNumber.from(block.timestamp);
}

async function advanceTimeAndBlock(time) {
    await increase(time);
    await advanceBlock();
}

async function advanceTime(time) {
    await ethers.provider.send("evm_increaseTime", [time]);
}

const duration = {
    seconds: function (val) {
        return BigNumber.from(val);
    },
    minutes: function (val) {
        return BigNumber.from(val).mul(this.seconds("60"));
    },
    hours: function (val) {
        return BigNumber.from(val).mul(this.minutes("60"));
    },
    days: function (val) {
        return BigNumber.from(val).mul(this.hours("24"));
    },
    weeks: function (val) {
        return BigNumber.from(val).mul(this.days("7"));
    },
    years: function (val) {
        return BigNumber.from(val).mul(this.days("365"));
    },
};

module.exports = {
    currentBlock,
    advanceBlock,
    advanceBlockTo,
    increase,
    latest,
    advanceTimeAndBlock,
    advanceTime,
    duration,
};