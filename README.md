


## MasterChef

The MasterChef contract is a smart contract that manages staking of LP tokens and distribution of rewards in the form of multiple ERC20 tokens (referred to as reward tokens). The contract allows users to stake their LP tokens in a given pool and receive rewards in proportion to their share of the total staked amount. The rewards are distributed over time, with new reward tokens being added periodically.
Thiscontract is modeled after SushiSwap's Masterchef and built on the Ethereum blockchain using Solidity version 0.8.0 and utilizes the OpenZeppelin.

#### Requirements
+ Node.js
+ Truffle
+ Hardhat

#### Installation


1. Install dependencies.
```shell
git clone https://github.com/0x00dev/MasterChef.git
```

2. Install dependencies.
```shell
npm install
```

3. Compile the contract.
```shell
npx hardhat compile
```

4. Deploy the contract to a test network or the mainnet.
```shell
npx hardhat run scripts/deploy.js
```

#### Usage

The MasterChef contract is intended to be used as part of a larger decentralized application (dApp) that allows users to stake their LP tokens and earn rewards. Developers can integrate the contract into their dApp by interacting with it using web3.js or another Ethereum-compatible library.

To use the contract, users must first approve the contract to spend their LP tokens. This can be done using the ```approve``` function on the LP token contract. Once approved, users can deposit their LP tokens into a specific pool using the ```deposit``` function. Users can then claim pending rewards for each supported reward token using the ```claim``` function. When users are ready to withdraw their LP tokens, they can do so using the ```withdraw``` function.

#### License

This project is licensed under the [MIT License](https://opensource.org/license/mit/ "MIT License link")
