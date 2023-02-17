const { WebSocket, WebSocketServer } = require('ws');
const crypto = require('crypto');

const { AeSdk, Node, unpackTx, buildAuthTxHash, isAddressValid } = require('@aeternity/aepp-sdk');
const Signer = require('./db/Signer');
const Tx = require('./db/Tx');

const CONTRACT_ACI = require('./contractAci.json');
const { Buffer } = require('buffer');
const { TxUnpackFailedError, TxHashNotMatchingError, HashAlreadyExistentError } = require('./util');

if (!process.env.MIDDLEWARE_URL) throw new Error('MIDDLEWARE_URL Environment Missing');
if (process.env.MIDDLEWARE_URL.match(/\/$/)) throw new Error('MIDDLEWARE_URL can not end with a trailing slash');
if (!process.env.NODE_URL) throw new Error('NODE_URL Environment Missing');

let node = new Node(process.env.NODE_URL);
let client = null;
let wss = null;

let wssSubscriptions = {};

const MULTISIG_CREATED = 'MULTISIG_CREATED';
const TX_PROPOSED = 'TX_PROPOSED';

const initWebsocketClient = () => {
  const ws = new WebSocket(process.env.MIDDLEWARE_URL.replace('https', 'wss') + '/v2/websocket');

  ws.on('open', function open() {
    ws.send('{"op":"Subscribe", "payload": "Transactions"}');
  });

  ws.on('error', console.error);

  ws.on('message', async (data) => {
    const json = JSON.parse(data);
    if (json.payload && json.source === 'mdw' && filterGaMultiSigCreateTx(json.payload)) {
      const { ownerId, height } = filterGaMultiSigCreateTx(json.payload);

      // wait a bit for contract to be available, can be improved
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await indexContract(ownerId, height);
    }
  });
};

const initWebsocketServer = () => {
  if (!wss) {
    wss = new WebSocketServer({ port: 8080 });

    wss.on('connection', (ws) => {
      ws.on('error', console.error);

      ws.on('close', () => {
        delete wssSubscriptions[ws.address][ws.id];
      });

      ws.on('message', (data) => {
        const json = JSON.parse(data);
        if (json.address && isAddressValid(json.address)) {
          if (!wssSubscriptions[json.address]) wssSubscriptions[json.address] = {};

          ws.id = crypto.randomBytes(16).toString('hex');
          ws.address = json.address;

          wssSubscriptions[json.address][ws.id] = ws;

          ws.send(JSON.stringify({ status: 'subscribed' }));
        }
      });
    });
  }
};

const initClient = async () => {
  if (!client) {
    client = new AeSdk({
      nodes: [
        {
          name: 'node',
          instance: node,
        },
      ],
    });
  }
};

const nextHeight = () => {
  return Signer.findOne({ order: [['height', 'DESC']] }).then((signer) => (signer ? signer.height : 0));
};

let latestCheckedCursor = '';

function filterGaMultiSigCreateTx(tx) {
  if (tx && tx.tx && tx.tx.type === 'PayingForTx' && tx.tx.tx && tx.tx.tx.tx && tx.tx.tx.tx.type === 'GAAttachTx' && tx.tx.tx.tx.owner_id) {
    return { ownerId: tx.tx.tx.tx.owner_id, height: tx.block_height };
  } else return null;
}

function sendWebsocketEvent(signerId, event, data) {
  if (wssSubscriptions[signerId]) Object.values(wssSubscriptions[signerId]).forEach((ws) => ws.send(JSON.stringify({ event, data })));
}

async function indexContract(ownerId, height) {
  const contractAddress = await client.getAccount(ownerId).then(({ contractId }) => contractId);
  const contractInstance = await client.getContractInstance({ aci: CONTRACT_ACI, contractAddress });

  const version = (await contractInstance.methods.get_version()).decodedResult;
  const signerIds = (await contractInstance.methods.get_signers()).decodedResult;
  //const consensus = (await contractInstance.methods.get_consensus_info()).decodedResult;

  process.stdout.write('+');

  const signers = await Signer.bulkCreate(
    signerIds.map((signerId) => ({
      signerId,
      contractId: contractAddress,
      height: height,
      gaAccountId: ownerId,
      version,
    })),
    { ignoreDuplicates: true },
  );

  signers.forEach((signer) => sendWebsocketEvent(signer.signerId, MULTISIG_CREATED, signer));
  return { contractAddress, version, signerIds };
}

const indexSigners = async (height = 0, url = `/v2/txs?scope=gen:${height}-${Number.MAX_SAFE_INTEGER}&direction=forward&type=ga_attach&limit=10`) => {
  const { data, next } = await fetch(`${process.env.MIDDLEWARE_URL}${url}`).then((res) => res.json());

  const checkCursor = height + ';' + data.length + ';' + next;
  //console.log(latestCheckedCursor === checkCursor, checkCursor, latestCheckedCursor);
  if (latestCheckedCursor === checkCursor) {
    console.log('already checked', latestCheckedCursor);
    return;
  } else latestCheckedCursor = checkCursor;

  const owners = await data.map((tx) => filterGaMultiSigCreateTx(tx)).filter((x) => !!x);

  await owners.reduce(async (promiseAcc, { ownerId, height }) => {
    const acc = await promiseAcc;
    try {
      const { contractAddress, signerIds, version } = await indexContract(ownerId, height);

      acc.push({
        ownerId,
        height,
        contractAddress,
        signerIds,
        version,
        //consensus,
      });
    } catch (e) {
      // there will be cases that we check, but not of our contract, that then throw, ignore them
      console.error(ownerId, e.message);
      process.stdout.write('-');
    }

    // currently return value is not used, but maybe we want
    return acc;
  }, []);

  console.log('next', next);
  if (next) await indexSigners(height, next);
};

const createDBIfNotExists = async () => {
  await Signer.sync();
  await Tx.sync();
};

const cleanDB = async () => {
  await Signer.sync({ force: true });
  await Tx.sync({ force: true });
};

const createTransaction = async (hash, tx) => {
  try {
    const unpackedTx = unpackTx(tx);

    Signer.findAll({
      where: {
        gaAccountId: unpackedTx.tx.senderId,
      },
    }).then((signers) => signers.forEach((signer) => sendWebsocketEvent(signer.signerId, TX_PROPOSED, signer)));
  } catch (e) {
    console.error(e);
    throw new TxUnpackFailedError();
  }

  const computedHash = Buffer.from(await buildAuthTxHash(tx, { onNode: node })).toString('hex');
  if (computedHash !== hash) throw new TxHashNotMatchingError();
  return Tx.create({ hash, tx }).catch((e) => {
    if (e.errors?.some((e) => e.validatorKey === 'not_unique')) throw new HashAlreadyExistentError();
    else throw e;
  });
};

module.exports = {
  cleanDB,
  createDBIfNotExists,
  indexSigners,
  nextHeight,
  initClient,
  initWebsocketClient,
  initWebsocketServer,
  createTransaction,
};
