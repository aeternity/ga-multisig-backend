const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {Encoder} = require('@aeternity/aepp-calldata')
const {Universal, Node} = require('@aeternity/aepp-sdk')

const CONTRACT = fs.readFileSync(path.join(__dirname, '../utils/aeternity/contracts/SimpleGAMultiSig.aes'), 'utf-8');

const main = async () => {


  const client = await Universal({
    compilerUrl: 'https://compiler.aepps.com',
    nodes: [{
      name: 'node',
      instance: await Node({url: 'https://testnet.test.aeternity.art/'}),
    }],
  })


  const res = await axios.get('https://testnet.test.aeternity.art/mdw/v2/txs?direction=backward&type=ga_attach');
  const owners = res.data.data.flatMap(tx => {
    // find transactions payfor with nested gaattach
    if (tx && tx.tx && tx.tx.tx && tx.tx.tx.tx && tx.tx.tx.tx.call_data) {
      return tx.tx.tx.tx.owner_id;
    }
  });

  const consensusInfo = owners.map(async (owner) => {
    try {
      const contractAddress = await axios.get(`https://testnet.test.aeternity.art/v3/accounts/${owner}`).then(({data}) => data.contract_id);
      const contractInstance = await client.getContractInstance({source: CONTRACT, contractAddress});

      const signers = (await contractInstance.methods.get_signers()).decodedResult
      const version = (await contractInstance.methods.get_version()).decodedResult
      const consensus = (await contractInstance.methods.get_consensus_info()).decodedResult

      return {
        owner, contractAddress,
        signers, version, consensus,
      };
    } catch (e) {
      return null;
    }
  })


  console.log(await Promise.all(consensusInfo));


};

main();
