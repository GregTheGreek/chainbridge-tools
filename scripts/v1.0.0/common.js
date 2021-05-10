const fs = require('fs');
const ethers = require("ethers");

const ProposalStatus = {
    Inactive: 0,
    Active: 1,
    Passed: 2,
    Executed: 3,
    Cancelled: 4
}

const FILEPATH = `./logs/chainbridge-logfile-${Date.now()}.txt`;
const log = async (msg) => {
    if (!fs.existsSync(FILEPATH)) {
      fs.writeFileSync(FILEPATH, msg);
    } else {
      fs.appendFileSync(FILEPATH, msg);
    }
  }
  
const createDataHash = (amount, recipient, destHandler, originId, transactionHash) => {
    if (recipient.substr(0, 2) === "0x") {
            recipient = recipient.substr(2)
    }
    const bigAmount = ethers.BigNumber.from(amount);
    try {
        const data = '0x' +
        ethers.utils.hexZeroPad(ethers.utils.hexlify(bigAmount.toHexString()), 32).substr(2) +
        ethers.utils.hexZeroPad(ethers.utils.hexlify(recipient.length / 2 + recipient.length % 2), 32).substr(2) +
        recipient;
        return ethers.utils.solidityKeccak256(["address", "bytes"], [destHandler, data]);
    } catch (e) {
        log(`
        Couldn't process the deposit: ${chains[originId].explorerBase}${transactionHash}
        Error: ${e}
        `)
        return;
    }
}

module.exports = {
  ProposalStatus,
  log,
  createDataHash,
}