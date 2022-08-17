const axios = require('axios');
const WebSocket = require('ws');
const { Universal, Node } = require('@aeternity/aepp-sdk');
const Signer = require('./Signer');
const Tx = require("./Tx");

const CONTRACT_SOURCE = require('ga-multisig-contract/SimpleGAMultiSig.aes');

const mdwBaseUrl = 'https://testnet.aeternity.io/mdw';
let client = null;

const initWebsocket = () => {
  const ws = new WebSocket(mdwBaseUrl.replace('https', 'wss') + '/websocket');

  ws.on('open', function open() {
    ws.send('{"op":"Subscribe", "payload": "Transactions"}');
  });

  ws.on('error', console.error);

  ws.on('message', async (data) => {
    const json = JSON.parse(data);
    if (json.payload && filterTx(json.payload)) {
      const { ownerId, height } = filterTx(json.payload);

      // wait a bit for contract to be available, can be improved
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await indexContract(ownerId, height);
    }
  });
};

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

const nextHeight = () => {
  return Signer.findOne({ order: [['height', 'DESC']] }).then((signer) => (signer ? signer.height : 0));
};

let latestCheckedCursor = '';

function filterTx(tx) {
  if (tx && tx.tx && tx.tx.type === 'PayingForTx' && tx.tx.tx && tx.tx.tx.tx && tx.tx.tx.tx.type === 'GAAttachTx' && tx.tx.tx.tx.owner_id) {
    return { ownerId: tx.tx.tx.tx.owner_id, height: tx.block_height };
  } else return null;
}

async function indexContract(ownerId, height) {
  const contractAddress = await axios.get(`https://testnet.aeternity.io/v3/accounts/${ownerId}`).then(({ data }) => data.contract_id);
  const contractInstance = await client.getContractInstance({ source: CONTRACT_SOURCE, contractAddress });

  const version = (await contractInstance.methods.get_version()).decodedResult;
  const signers = (await contractInstance.methods.get_signers()).decodedResult;
  //const consensus = (await contractInstance.methods.get_consensus_info()).decodedResult;

  process.stdout.write('+');

  await Signer.bulkCreate(
    signers.map((signer) => ({ signerId: signer, contractId: contractAddress, height: height, gaAccountId: ownerId })),
    { ignoreDuplicates: true },
  );

  return { contractAddress, version, signers };
}

const indexSigners = async (height = 0, url = `/v2/txs?scope=gen:${height}-${Number.MAX_SAFE_INTEGER}&direction=forward&type=ga_attach&limit=10`) => {
  const { data, next } = await axios.get(`${mdwBaseUrl}${url}`).then((res) => res.data);

  const checkCursor = height + ';' + data.length + ';' + next;
  console.log(latestCheckedCursor === checkCursor, checkCursor, latestCheckedCursor);
  if (latestCheckedCursor === checkCursor) {
    console.log('already checked', latestCheckedCursor);
    return;
  } else latestCheckedCursor = checkCursor;

  const owners = await data.map((tx) => filterTx(tx)).filter((x) => !!x);

  await owners.reduce(async (promiseAcc, { ownerId, height }) => {
    const acc = await promiseAcc;
    try {
      const { contractAddress, signers, version } = await indexContract(ownerId, height);

      acc.push({
        ownerId,
        height,
        contractAddress,
        signers,
        version,
        //consensus,
      });
    } catch (e) {
      // there will be cases that we check, but not of our contract, that then throw, ignore them
      // console.error(txi, e.message);
      process.stdout.write('-');
    }

    // currently return value is not used, but maybe we want
    return acc;
  }, []);

  if (next) await indexSigners(height, next);
};

const cleanDB = async () => {
  await Signer.sync({force: true});
  await Tx.sync({force: true});
}

module.exports = {
  cleanDB,
  indexSigners,
  nextHeight,
  initClient,
  initWebsocket,
};
