const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {Universal, Node} = require('@aeternity/aepp-sdk')
const Signer = require('./Signer')

const CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '../utils/aeternity/contracts/SimpleGAMultiSig.aes'), 'utf-8');


const main = async () => {

  await Signer.sync({force: true});

  const client = await Universal({
    compilerUrl: 'https://compiler.aepps.com',
    nodes: [{
      name: 'node',
      instance: await Node({url: 'https://testnet.aeternity.art/'}),
    }],
  })

  const res = await axios.get('https://testnet.aeternity.art/mdw/v2/txs?direction=backward&type=ga_attach');
  const owners = res.data.data.flatMap(tx => {
    // find transactions payfor with nested gaattach
    if (tx && tx.tx && tx.tx.type === 'PayingForTx' && tx.tx.tx && tx.tx.tx.tx && tx.tx.tx.tx.type === 'GAAttachTx' && tx.tx.tx.tx.owner_id) {
      return tx.tx.tx.tx.owner_id;
    }
  });

  console.log('possible owners', owners.length);

  const consensusInfo = await owners.reduce(async (promiseAcc, owner) => {
    const acc = await promiseAcc;
    try {
      const contractAddress = await axios.get(`https://testnet.aeternity.art/v3/accounts/${owner}`).then(({data}) => data.contract_id);
      const contractInstance = await client.getContractInstance({source: CONTRACT_SOURCE, contractAddress});

      const signers = (await contractInstance.methods.get_signers()).decodedResult
      const version = (await contractInstance.methods.get_version()).decodedResult
      const consensus = (await contractInstance.methods.get_consensus_info()).decodedResult

      process.stdout.write('+');

      await Signer.bulkCreate(signers.map(signer => ({signerId: signer, contractId: contractAddress})));

      acc.push({
        owner, contractAddress,
        signers, version, consensus,
      });
    } catch (e) {
      process.stdout.write('-');
    }
    return acc;
  }, []);

  console.log(consensusInfo);
};

main();
