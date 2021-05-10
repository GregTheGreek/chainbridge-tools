/**
 * This file aims to calculate the total value deposited.
 */
const Web3 = require("web3");
const Table = require("cli-table");
const axios = require("axios");
const BigNumber = require('bignumber.js');

const bridge = require("./abi/Bridge.json");
const handler = require("./abi/ERC20Handler.json");
const erc20 = require("./abi/IERC20.json");

const debug = false;

const db = {
  deposits: {}
}

async function main() {
  const web3 = new Web3(process.argv[2]);
  const BridgeInstance = new web3.eth.Contract(bridge.abi, "0x96B845aBE346b49135B865E5CeDD735FC448C3aD");
  const HandlerInstance = new web3.eth.Contract(handler.abi, "0xdAC7Bb7Ce4fF441A235F08408e632FA1D799A147");
  
  const deposits = await BridgeInstance.getPastEvents("Deposit", {
    fromBlock: 11688196
  })
  const totalDeposits = deposits.length;

  // for (let i=0;i<10;i++) {
  for (let i=0;i<totalDeposits;i++) {
      process.stdout.write(`Processing deposit ${i + 1}/${totalDeposits} \r`);
    const deposit = deposits[i];
    const {destinationChainID, resourceID, depositNonce} = deposit.returnValues;

    const handlerAddress = await BridgeInstance.methods._resourceIDToHandlerAddress(resourceID).call();
    if (handlerAddress == HandlerInstance._address) {
      const {_tokenAddress, _amount, _depositer} = await HandlerInstance.methods._depositRecords(destinationChainID, depositNonce).call();
      if (!db.deposits[_tokenAddress]) {
        const tokenInstance = new web3.eth.Contract(erc20.abi, _tokenAddress);
        const name = await tokenInstance.methods.name().call();
        const decimals = await tokenInstance.methods.decimals().call();
        db.deposits[_tokenAddress] = {
          deposits: [],
          name,
          decimals,
          totalTokens: new BigNumber(0)
        };
      }
      const amount = new BigNumber(_amount);
      db.deposits[_tokenAddress].deposits.push({
        amount: amount,
        from: _depositer,
        block: deposit.blockNumber
      })
      db.deposits[_tokenAddress].totalTokens = db.deposits[_tokenAddress].totalTokens.plus(amount);
    }
  };
  await log();
}

async function log() {
  const table = new Table({
    head: ["Name", "Address", "# Deposits", "# Tokens Deposited", "USD Value (Today)", "USD Value (at deposit date)"]
  })
  for (let address in db.deposits) {
    const token = db.deposits[address];
    // process.stdout.write(`Processing ${token.name} \r`);
    console.log("begin")
    if (debug) {
      console.log(`
      Name:     ${token.name}
      Decimals: ${token.decimals}
      Address:  ${address}
      Deposits: ${token.deposits.length}
      # tokens: ${formatTokens(token)}
      ===================
      `)
    }
    const totalTokens = formatTokens(token);
    const {price} = await getPrice(address);
    const tvlToday = (new BigNumber(totalTokens)).multipliedBy(new BigNumber(price));

    console.log({price})
    console.log({totalTokens})
    console.log("tvl", tvlToday.toString())

    table.push([
      token.name, 
      address, 
      token.deposits.length, 
      totalTokens,
      tvlToday,
      "TBD"
    ])
  }
  console.log(table.toString());
}

function formatTokens(token) {
  console.log("line 85")
  const bigString = token.totalTokens.toString();
  console.log("line 87")
  let front = bigString.substr(0, bigString.length - token.decimals);
  console.log("line 89")
  front = front == "" ? "0" : front;
  console.log("line 91")
  const res = front + "." + bigString.substr(token.decimals * -1);
  console.log("line 93")
  return res; 
}

async function getPrice(address) {
  // Only fetches current price
  const {data} = await axios.get(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}/market_chart/?vs_currency=usd&days=0`);
  const price = data.prices[0][1]; // [[timestamp, price]]
  return {price};
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
