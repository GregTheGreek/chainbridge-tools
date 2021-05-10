/**
 * This file helps track a deposit from one chain to another.
 */
const Web3 = require("web3");
const BigNumber = require('bignumber.js');
const ethers = require("ethers");

const bridge = require("./abi/Bridge.json");
const handler = require("./abi/ERC20Handler.json");
const erc20 = require("./abi/IERC20.json");
const {log, createDataHash, ProposalStatus} = require("./common");

/**
 * Deposit Event
 * {
  address: '0x96B845aBE346b49135B865E5CeDD735FC448C3aD',
  blockHash: '0x9a49eeb53403c8a1de9f340ddf18004f3f0b2e0294d4469bd5eefe68ccbf13ab',
  blockNumber: 12388282,
  logIndex: 113,
  removed: false,
  transactionHash: '0x2bfda39664dea7f212778415145d8c52571ab3ab20d8edfbe805891f1665bb36',
  transactionIndex: 147,
  id: 'log_18f2f174',
  returnValues: Result {
    '0': '2',
    '1': '0x0000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc201',
    '2': '7961',
    destinationChainID: '2',
    resourceID: '0x0000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc201',
    depositNonce: '7961'
  },
  event: 'Deposit',
  signature: '0xdbb69440df8433824a026ef190652f29929eb64b4d1d5d2a69be8afe3e6eaed8',
  raw: {
    data: '0x',
    topics: [
      '0xdbb69440df8433824a026ef190652f29929eb64b4d1d5d2a69be8afe3e6eaed8',
      '0x0000000000000000000000000000000000000000000000000000000000000002',
      '0x0000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc201',
      '0x0000000000000000000000000000000000000000000000000000000000001f19'
    ]
  }
}
* TransferRecord
  {
    _tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    _lenDestinationRecipientAddress: '20',
    _destinationChainID: '2',
    _resourceID: '0x0000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc201',
    _destinationRecipientAddress: '0xd242a88f202b793a80a353264f1c51d292bc951b',
    _depositer: '0xd242a88f202B793a80A353264F1C51D292bc951b',
    _amount: '10000000000000000000'
  }
*/
// const chains = {
//   "2": {
//     chainId: 2,
//     name: "Ava",
//     web3: new Web3(process.argv[3]),
//     fromBlock: 29954,
//     bridgeAddress: "0x6460777cDa22AD67bBb97536FFC446D65761197E",
//     handlerAddress: "0x6147F5a1a4eEa5C529e2F375Bd86f8F58F8Bc990",
//     explorerBase: "https://cchain.explorer.avax.network/tx/",
//     expiry: 7200000,
//   },
//   "1": {
//     chainId: 1,
//     name: "Ethereum",
//     web3: new Web3(process.argv[2]),
//     fromBlock: 12388196,
//     // fromBlock: 11688196,
//     bridgeAddress: "0x96B845aBE346b49135B865E5CeDD735FC448C3aD",
//     handlerAddress: "0xdAC7Bb7Ce4fF441A235F08408e632FA1D799A147",
//     explorerBase: "https://etherscan.io/tx/",
//     expiry: 100,
//   },
// }

const traceDeposit = async (originId, deposit, transferRecord, destChain) => {
  const {depositNonce} = deposit.returnValues;
  const {_amount, _destinationRecipientAddress} = transferRecord;
  // Select the destination chain
  const BridgeInstance = new destChain.web3.eth.Contract(bridge.abi, destChain.bridgeAddress);
  // Build the datahash
  const dataHash = createDataHash(_amount, _destinationRecipientAddress, destChain.handlerAddress, originId, deposit.transactionHash);
  if (!dataHash) return; // Error processing
  // Query for the proposal
  const proposal = await BridgeInstance.methods.getProposal(originId, depositNonce, dataHash).call();

  return {
    dataHash,
    proposal
  }
}

/**
 * trace - Traces all deposits from one chain to another
 * @param {Object} chains
 */
const trace = async (chains) => {
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
    }
  }
}

module.exports = {
  trace,
  traceDeposit,
}