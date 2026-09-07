const WebSocket = require('ws');
const { AeSdk, Node, Contract, unpackTx, buildAuthTxHash, getCachedProtocolParameters, ArgumentError, IllegalArgumentError } = require('@aeternity/aepp-sdk');
const Signer = require('./db/Signer');
const Tx = require('./db/Tx');

const CONTRACT_ACI = require('./contractAci.json');
const { Buffer } = require('buffer');
const { TxUnpackFailedError, TxHashNotMatchingError, HashAlreadyExistentError, logError } = require('./util');
const { migrate } = require('./db/migration');

// The GaMetaTx `fee`/`gasPrice` every wallet used while the sdk priced them by the constants of
// its own release. Since sdk@15 a wallet prices them by what the connected node reports, so they
// follow a fee raise on the network and this pair is only what a wallet built against an older sdk
// would have used - see `matchesAuthTxHash`.
const LEGACY_GA_META_PARAMS = { fee: 1e14, gasPrice: 1e9 };

if (!process.env.MIDDLEWARE_URL) throw new Error('MIDDLEWARE_URL Environment Missing');
if (process.env.MIDDLEWARE_URL.match(/\/$/)) throw new Error('MIDDLEWARE_URL can not end with a trailing slash');
if (!process.env.NODE_URL) throw new Error('NODE_URL Environment Missing');

let node = new Node(process.env.NODE_URL);
let client = null;

const initWebsocket = () => {
  const ws = new WebSocket(process.env.MIDDLEWARE_URL.replace('https', 'wss') + '/v2/websocket');

  ws.on('open', function open() {
    ws.send('{"op":"Subscribe", "payload": "Transactions"}');
  });

  ws.on('error', logError);

  ws.on('message', async (data) => {
    const json = JSON.parse(data);
    if (json.payload && json.source === 'mdw' && filterTx(json.payload)) {
      const { ownerId, height } = filterTx(json.payload);

      // wait a bit for contract to be available, can be improved
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await indexContract(ownerId, height);
    }
  });
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

function filterTx(tx) {
  if (tx && tx.tx && tx.tx.type === 'PayingForTx' && tx.tx.tx && tx.tx.tx.tx && tx.tx.tx.tx.type === 'GAAttachTx' && tx.tx.tx.tx.owner_id) {
    return { ownerId: tx.tx.tx.tx.owner_id, height: tx.block_height };
  } else return null;
}

async function indexContract(ownerId, height) {
  const contractAddress = await client.getAccount(ownerId).then(({ contractId }) => contractId);
  const contractInstance = await Contract.initialize({ onNode: node, aci: CONTRACT_ACI, address: contractAddress });

  const version = (await contractInstance.get_version()).decodedResult;
  const signers = (await contractInstance.get_signers()).decodedResult;
  //const consensus = (await contractInstance.methods.get_consensus_info()).decodedResult;

  process.stdout.write('+');

  await Signer.bulkCreate(
    signers.map((signer) => ({ signerId: signer, contractId: contractAddress, height: height, gaAccountId: ownerId, version })),
    { ignoreDuplicates: true },
  );

  return { contractAddress, version, signers };
}

const indexSigners = async (height = 0, url = `/v2/txs?scope=gen:${height}-${Number.MAX_SAFE_INTEGER}&direction=forward&type=paying_for&limit=10`) => {
  let data;
  let next;
  try {
    ({ data, next } = await (await fetch(`${process.env.MIDDLEWARE_URL}${url}`)).json());
  } catch (e) {
    logError('indexSigners[fetchFromMiddleware]', url, e);
    throw e;
  }

  const checkCursor = height + ';' + data.length + ';' + next;
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
      logError('indexSigners[indexContract]', ownerId, e.message);
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

  await migrate();
};

const cleanDB = async () => {
  await Signer.sync({ force: true });
  await Tx.sync({ force: true });
};

// A `gasPrice` below the consensus minimum node reports can't be part of a GaMetaTx node would
// accept, and a `fee` that isn't an amount can't be part of one at all - both make a hash that
// doesn't match rather than a failure to check it, so the next candidate is tried instead.
const matchesAuthTxHash = async (hash, tx, gaMetaParams) => {
  try {
    return (await buildAuthTxHash(tx, { onNode: node, ...gaMetaParams })).toString('hex') === hash;
  } catch (e) {
    if (e instanceof ArgumentError || e instanceof IllegalArgumentError) return false;
    throw e;
  }
};

// The auth hash binds `hash` to `tx`, so a transaction can't be stored under the hash of an
// unrelated one. It is derived from the GaMetaTx `fee`/`gasPrice` the wallet built that transaction
// with, and since sdk@15 the wallet prices those by the consensus parameters and the demand of the
// node it is connected to instead of by the constants of an sdk release. A raise on the network
// therefore moves them, and they can't be assumed here - so a wallet that sends the values it used
// is checked against exactly those. One that doesn't is checked against the pair wallets used
// before the raise and then against the minimums node reports, which keeps clients built against an
// older sdk working across a raise without them having to send anything.
const authTxHashMatches = async (hash, tx, gaMetaParams) => {
  if (gaMetaParams != null) return matchesAuthTxHash(hash, tx, gaMetaParams);

  if (await matchesAuthTxHash(hash, tx, LEGACY_GA_META_PARAMS)) return true;

  const { minGasPrice, minMinerGasPrice } = await getCachedProtocolParameters(node);
  const gasPrices = [...new Set([minGasPrice, minMinerGasPrice])].filter((gasPrice) => gasPrice > BigInt(LEGACY_GA_META_PARAMS.gasPrice));
  for (const gasPrice of gasPrices) {
    if (await matchesAuthTxHash(hash, tx, { fee: LEGACY_GA_META_PARAMS.fee, gasPrice: gasPrice.toString() })) return true;
  }
  return false;
};

const createTransaction = async (hash, tx, gaMetaParams) => {
  try {
    unpackTx(tx);
  } catch (e) {
    logError('createTransaction[unpackTx]', tx, hash, e);
    throw new TxUnpackFailedError();
  }

  let matches;
  try {
    matches = await authTxHashMatches(hash, tx, gaMetaParams);
  } catch (e) {
    logError('createTransaction[buildAuthTxHash]', e);
    throw e;
  }
  if (!matches) {
    logError('createTransaction[buildAuthTxHash]', tx, hash, gaMetaParams);
    throw new TxHashNotMatchingError();
  }

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
  initWebsocket,
  createTransaction,
};
