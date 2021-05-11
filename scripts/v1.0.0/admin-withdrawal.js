/**
 * This file helps track a deposit from one chain to another.
 */
const Web3 = require("web3");
const BigNumber = require('bignumber.js');
const fs = require('fs')
const abiDecoder = require('abi-decoder');

const bridge = require("./abi/Bridge.json");
const multisig = require('./abi/Multisig.json');
const erc20 = require("./abi/IERC20.json");
const fetch = require("node-fetch");
const {log} = require("./common");

abiDecoder.addABI(multisig);
abiDecoder.addABI(bridge.abi);

const getEthereumTransactionsByAccount = async (address, api_key = 'UF9IAYD4IHATIXQ3IAW1BMEJX3YSK83SZJ', start_block = 0, end_block = 99999999999999999999, sort = 'asc') => {
    try {
        let url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=${start_block}&endblock=${end_block}&sort=${sort}&apikey=${api_key}`
        let response = await fetch(url)
        let data = await response.json()
        return data.result
    } catch (e) {
        console.log(e)
        await log(e)
    }
}

const getAvalancheTransactionsByAccount = async (address, start_block = 0, end_block = 99999999999999999999) => {
    try {
        let url = `https://explorerapi.avax.network/v2/ctransactions?address=${address}&blockStart=${start_block}&blockEnd=${end_block}`
        let response = await fetch(url)
        let data = await response.json()

        //Overwrite the input field with traces[0].input
        for (const key in data.Transactions) {
            data.Transactions[key].input = data.Transactions[key].traces[0].input
        }

        return data.Transactions
    } catch (e) {
        console.log(e)
        await log(e)
    }
}

const chains = {
    "2": {
        chainId: 2,
        name: "Ava",
        web3: new Web3(process.argv[3]),
        fromBlock: 29954,
        bridgeAddress: "0x6460777cDa22AD67bBb97536FFC446D65761197E",
        handlerAddress: "0x6147F5a1a4eEa5C529e2F375Bd86f8F58F8Bc990",
        multisigAddress: '0x751e9AD7DdA35EC5217fc2D1951a5FFB0617eafE',
        explorerBase: "https://cchain.explorer.avax.network/tx/",
        expiry: 7200000,
        getTransactionsByAccount: getAvalancheTransactionsByAccount
    },
    "1": {
        chainId: 1,
        name: "Ethereum",
        web3: new Web3(process.argv[2]),
        fromBlock: 12388196,
        // fromBlock: 11688196,
        bridgeAddress: "0x96B845aBE346b49135B865E5CeDD735FC448C3aD",
        handlerAddress: "0xdAC7Bb7Ce4fF441A235F08408e632FA1D799A147",
        multisigAddress: '0xfD018E845DD2A5506C438438AFA88444Cf7A8D89',
        explorerBase: "https://etherscan.io/tx/",
        expiry: 100,
        getTransactionsByAccount: getEthereumTransactionsByAccount
    },
}

const fetchAdminWithdrawals = async () => {
    const withdrawalByChain = {}
    for (const key in chains) {
        const chain = chains[key];

        //Collect all transaction data from etherscan
        await log("Grabbing all Ethereum Multisig transactions via Etherscan")
        const multisig_transactions = await chain.getTransactionsByAccount(chain.multisigAddress)

        await log("Filtering for exec transaction calls")
        const exec_transactions = multisig_transactions.filter(tx => tx.input !== undefined && tx.input.startsWith('0x6a761202'))

        await log("Got " + exec_transactions.length + " transactions")

        await log("Looking for adminWithdrawal in exec transactions")
        const withdrawals = {}
        for (const index in exec_transactions) {
            const tx = exec_transactions[index]; //js dumb

            const normalized_input = abiDecoder.decodeMethod(tx.input);

            const data = normalized_input.params.find(p => p.name === 'data').value

            if (data.startsWith('0x780cf004')) {
                const normalized_withdrawal_input = abiDecoder.decodeMethod(data);

                const token = normalized_withdrawal_input.params.find(p => p.name === 'tokenAddress').value
                const amount = new BigNumber(normalized_withdrawal_input.params.find(p => p.name === 'amountOrTokenID').value)

                if (token in withdrawals) {
                    withdrawals[token] = withdrawals[token].plus(amount)
                } else {
                    withdrawals[token] = amount;
                }
            }
        }

        await log("Formatting withdrawal data")
        for (const token in withdrawals) {
            const token_contract = new chain.web3.eth.Contract(erc20.abi, token)

            const name = await token_contract.methods.name().call()
            const symbol = await token_contract.methods.symbol().call()
            const decimals = await token_contract.methods.decimals().call()

            withdrawals[token] = {
                name: name,
                symbol: symbol,
                decimals: decimals,
                formattedValue: withdrawals[token].div(new BigNumber(10).exponentiatedBy(new BigNumber(decimals))),
                value: withdrawals[token]
            }
        }

        withdrawalByChain[key] = withdrawals
    }

    return withdrawalByChain;
}

module.exports = {
    fetchAdminWithdrawals
}