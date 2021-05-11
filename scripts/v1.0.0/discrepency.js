/**
 * This file helps track a deposit from one chain to another.
 */
const Web3 = require("web3");
const BigNumber = require('bignumber.js');
const ethers = require("ethers");
const fs = require('fs')

const bridge = require("./abi/Bridge.json");
const handler = require("./abi/ERC20Handler.json");
const erc20 = require("./abi/IERC20.json");
const {log, ProposalStatus} = require("./common");
const {traceDeposit} = require("./traceDeposit");
const {fetchAdminWithdrawals} = require("./admin-withdrawal");

const chains = {
  "2": {
    chainId: 2,
    name: "Ava",
    web3: new Web3(process.argv[3]),
    fromBlock: 1399852,
    // fromBlock: 29954,
    bridgeAddress: "0x6460777cDa22AD67bBb97536FFC446D65761197E",
    handlerAddress: "0x6147F5a1a4eEa5C529e2F375Bd86f8F58F8Bc990",
    explorerBase: "https://cchain.explorer.avax.network/tx/",
    expiry: 7200000,
  },
  "1": {
    chainId: 1,
    name: "Ethereum",
    web3: new Web3(process.argv[2]),
    fromBlock: 12403219,
    // fromBlock: 11688196,
    bridgeAddress: "0x96B845aBE346b49135B865E5CeDD735FC448C3aD",
    handlerAddress: "0xdAC7Bb7Ce4fF441A235F08408e632FA1D799A147",
    explorerBase: "https://etherscan.io/tx/",
    expiry: 100,
  },
}

const transfers = {
  "1": {},
  "2": {}
}

const incTransfer = (originId, tokenAddress, _amount) => {
  const amount = new BigNumber(_amount);
  if (!transfers[originId][tokenAddress]) {
    transfers[originId][tokenAddress] = new BigNumber(0);
  }
  transfers[originId][tokenAddress] = transfers[originId][tokenAddress].plus(amount)
}

const doAccounting = async (web3, originId, proposal, deposit, dataHash, transferRecord) => {
  const {depositNonce} = deposit.returnValues;
  const currentBlock = await web3.eth.getBlockNumber();
  switch (parseInt(proposal._status)) {
    case ProposalStatus.Inactive:
      incTransfer(originId, transferRecord._tokenAddress, transferRecord._amount);

      log(`
      [NOT FOUND] - A deposit had no corresponding proposal on the destination chain.
      Deposit tx: ${chains[originId].explorerBase}${deposit.transactionHash}
      ResourceId: ${transferRecord._resourceID}
      Proposal Query: originId: ${originId} depositNonce: ${depositNonce} dataHash: ${dataHash} 
      =========
      `)
    case ProposalStatus.Active:
      if (currentBlock - parseInt(proposal._proposedBlock) > chains[transferRecord._destinationChainID].expiry) {
        incTransfer(originId, transferRecord._tokenAddress, transferRecord._amount);

        log(`
        [EXPIRED] - An active proposal has expired, the status has not changed to "4" (expired).
        Deposit tx: ${chains[originId].explorerBase}${deposit.transactionHash}
        ResourceId: ${transferRecord._resourceID}
        Proposal Query: originId: ${originId} depositNonce: ${depositNonce} dataHash: ${dataHash} 
        =========
        `)
      }
    case ProposalStatus.Passed:
      log(`
      [STUCK] - A proposal that met the threshold has not been executed.
      Deposit tx: ${chains[originId].explorerBase}${deposit.transactionHash}
      ResourceId: ${transferRecord._resourceID}
      Proposal Query: originId: ${originId} depositNonce: ${depositNonce} dataHash: ${dataHash} 
      =========
      `)
    case ProposalStatus.Executed:
      // todo
      // Can probably just ignore this case all together
    case ProposalStatus.Cancelled:
      incTransfer(originId, transferRecord._tokenAddress, transferRecord._amount);

      log(`
      [CANCELLED] - A proposal has been cancelled. 
      Deposit tx: ${chains[originId].explorerBase}${deposit.transactionHash}
      ResourceId: ${transferRecord._resourceID}
      Proposal Query: originId: ${originId} depositNonce: ${depositNonce} dataHash: ${dataHash} 
      =========
      `)
  }
}

const formatTokens = async (chain, chainId) => {
  res = {}
  for (address in transfers[chainId]) {
    const tokenInstance = new chain.web3.eth.Contract(erc20.abi, address);
    const name = await tokenInstance.methods.name().call();
    const symbol = await tokenInstance.methods.symbol().call()
    const decimals = await tokenInstance.methods.decimals().call();
    res[address] = {
        name: name,
        symbol: symbol,
        decimals: decimals,
        formattedValue: transfers[chainId][address].div(new BigNumber(10).exponentiatedBy(new BigNumber(decimals))),
        value: transfers[chainId][address]
    }
  };
  return res;
}

const main = async () => {
  const data = {}
  for (const key in chains) {
    const chain = chains[key];
    const BridgeInstance = new chain.web3.eth.Contract(bridge.abi, chain.bridgeAddress);
    const HandlerInstance = new chain.web3.eth.Contract(handler.abi, chain.handlerAddress);

    // Collect all deposits
    const deposits = await BridgeInstance.getPastEvents("Deposit", { fromBlock: chain.fromBlock });
    for (const deposit of deposits) {
      // Fetch the token transfer record from the handler
      const transferRecord = await HandlerInstance.methods._depositRecords(
        deposit.returnValues.destinationChainID, 
        deposit.returnValues.depositNonce
      ).call();
      // Trace the transaction
      const trace = await traceDeposit(chain.chainId, deposit, transferRecord, chains[deposit.returnValues.destinationChainID]);
      await doAccounting(chain.web3, chain.chainId, trace.proposal,deposit, trace.dataHash, transferRecord);
    }
    if (!data[key]) data[key] = {};
    data[key]["cancelled"] = await formatTokens(chain, key);
  }
  const admins = await fetchAdminWithdrawals();
  Object.keys(admins).forEach((key) => { data[key]["adminTransfer"] = admins[key] })
  const display = {}
  Object.keys(data).forEach((chainId) => {
    const deposits = data[chainId]["cancelled"];
    const admins = data[chainId]["adminTransfer"];
    
    Object.keys(deposits).forEach(key => {
      if (!display[chainId]) display[chainId] = {"user_deposits": {}, "admin_withdraw": {}};
      const token = deposits[key];
      console.log(display)
      display[chainId]["user_deposits"][token.name] = token.formattedValue.toString(); 
    })
    Object.keys(admins).forEach(key => {
      if (!display[chainId]) display[chainId] = {};
      const token = admins[key];
      display[chainId]["admin_withdraw"][token.name] = token.formattedValue.toString(); 
    })
  })
  console.log(display)
}

main()
  .then(() => process.exit(0))
  .catch(error => {{}
    console.error(error);
    process.exit(1);
  });

