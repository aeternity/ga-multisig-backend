const axios = require('axios');
const { Universal, Node } = require('@aeternity/aepp-sdk');
const Signer = require('./Signer');

const CONTRACT_SOURCE = require('ga-multisig-contract/SimpleGAMultiSig.aes');

const mdwBaseUrl = 'https://testnet.aeternity.io/mdw';
let client = null;

const initClient = async () => {
  if (!client) {
    client = await Universal({
      compilerUrl: 'https://compiler.aepps.com',
      nodes: [
        {
          name: 'node',
          instance: await Node({ url: 'https://testnet.aeternity.io/' }),
        },
      ],
    });
  }
};

const nextTxi = () => {
  return Signer.findOne({ order: [['txi', 'DESC']] }).then((signer) => (signer ? signer.txi + 1 : 0));
};

const indexSigners = async (lastTxi = 0, url = `/v2/txs?scope=txi:${lastTxi}-${Number.MAX_SAFE_INTEGER}&direction=forward&type=ga_attach&limit=10`) => {
  console.log(lastTxi, url);
  const { data, next } = await axios.get(`${mdwBaseUrl}${url}`).then((res) => res.data);
  const owners = data
    .map((tx) => {
      // find transactions payfor with nested gaattach
      if (tx && tx.tx && tx.tx.type === 'PayingForTx' && tx.tx.tx && tx.tx.tx.tx && tx.tx.tx.tx.type === 'GAAttachTx' && tx.tx.tx.tx.owner_id) {
        return { ownerId: tx.tx.tx.tx.owner_id, txi: tx.tx_index };
      }
    })
    .filter((x) => !!x);

  await owners.reduce(async (promiseAcc, { ownerId, txi }) => {
    const acc = await promiseAcc;
    try {
      const contractAddress = await axios.get(`https://testnet.aeternity.io/v3/accounts/${ownerId}`).then(({ data }) => data.contract_id);
      const contractInstance = await client.getContractInstance({ source: CONTRACT_SOURCE, contractAddress });

      const version = (await contractInstance.methods.get_version()).decodedResult;
      const signers = (await contractInstance.methods.get_signers()).decodedResult;
      const consensus = (await contractInstance.methods.get_consensus_info()).decodedResult;

      process.stdout.write('+');

      await Signer.bulkCreate(signers.map((signer) => ({ signerId: signer, contractId: contractAddress, txi })));

      acc.push({
        ownerId,
        txi,
        contractAddress,
        signers,
        version,
        consensus,
      });
    } catch (e) {
      // there will be cases that we check, but not of our contract, that then throw, ignore them
      // console.error(txi, e.message);
      process.stdout.write('-');
    }

    // currently return value is not used, but maybe we want
    return acc;
  }, []);

  if (next) await indexSigners(lastTxi, next);
};

const cleanDB = () => Signer.sync({ force: true });

module.exports = {
  cleanDB,
  indexSigners,
  nextTxi,
  initClient,
};
