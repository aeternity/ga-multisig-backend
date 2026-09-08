const WebSocket = require('ws');
const { AeSdk, Node, Contract, unpackTx } = require('@aeternity/aepp-sdk');
const Signer = require('./db/Signer');
const SyncState = require('./db/SyncState');
const Tx = require('./db/Tx');

const CONTRACT_ACI = require('./contractAci.json');
const { TxUnpackFailedError, TxHashNotMatchingError, HashAlreadyExistentError, isTransientError, positiveMsFromEnv, logError } = require('./util');
const { migrate } = require('./db/migration');
const { authTxHashMatches } = require('./authTxHash');

if (!process.env.MIDDLEWARE_URL) throw new Error('MIDDLEWARE_URL Environment Missing');
if (process.env.MIDDLEWARE_URL.match(/\/$/)) throw new Error('MIDDLEWARE_URL can not end with a trailing slash');
if (!process.env.NODE_URL) throw new Error('NODE_URL Environment Missing');

// Every request needs a deadline. A node or middleware that accepts the connection and then goes
// quiet - what one behind a load balancer looks like while it is unhealthy - otherwise never
// answers and never fails, and a request that never ends can not be retried either.
const REQUEST_TIMEOUT = positiveMsFromEnv('REQUEST_TIMEOUT_MS') ?? 30000;

// The middleware pages the transactions to scan and the pass makes one request per page, so a
// small page turns a rescan of a few weeks into hundreds of sequential round trips.
const MIDDLEWARE_PAGE_LIMIT = 100;

// How often a multisig may fail for a retryable reason before the pass stops waiting for it. It
// only counts up in passes where node answered for something else, so an outage - where
// everything fails - never gives up on anything.
const MAX_TRANSIENT_ATTEMPTS = 5;

const SYNC_STATE_ID = 1;

const WS_RECONNECT_MIN_DELAY = 1000;
const WS_RECONNECT_MAX_DELAY = 60000;

let node = new Node(process.env.NODE_URL);
let client = null;

// The http client of the sdk has no deadline of its own - `request.timeout` defaults to 0, meaning
// it waits forever - and its retry policy only reacts to a request that failed, never to one that
// hangs. Setting it on the pipeline covers every node request the sdk makes, including the ones
// `Contract` makes internally, and leaves the policies the sdk installs itself in place.
node.pipeline.addPolicy({
  name: 'request-timeout',
  sendRequest(request, next) {
    request.timeout ||= REQUEST_TIMEOUT;
    return next(request);
  },
});

// The indexer being alive is not the same as the process being up: a hung request or a websocket
// that silently stopped delivering both leave the server answering while nothing is indexed any
// more. This is the last time it actually heard back, and `/health` reports on it.
let lastProgressAt = Date.now();
const noteProgress = () => (lastProgressAt = Date.now());
const getLastProgress = () => lastProgressAt;

let wsReconnectDelay = WS_RECONNECT_MIN_DELAY;

const initWebsocket = () => {
  const ws = new WebSocket(process.env.MIDDLEWARE_URL.replace('https', 'wss') + '/v2/websocket');

  ws.on('open', function open() {
    wsReconnectDelay = WS_RECONNECT_MIN_DELAY;
    ws.send('{"op":"Subscribe", "payload": "Transactions"}');
  });

  ws.on('error', logError);

  // `ws` follows every `error` with a `close`, so redialing here covers a connection that was never
  // established as well as one that dropped. Without it a middleware restart ends realtime indexing
  // until the process is restarted, leaving only the once-a-minute pass to find new multisigs.
  ws.on('close', (code) => {
    const delay = wsReconnectDelay;
    wsReconnectDelay = Math.min(delay * 2, WS_RECONNECT_MAX_DELAY);
    console.log('websocket closed', code, `- reconnecting in ${delay}ms`);
    setTimeout(initWebsocket, delay);
  });

  ws.on('message', async (data) => {
    try {
      noteProgress();

      const json = JSON.parse(data);
      if (json.source !== 'mdw') return;
      const multisig = filterTx(json.payload);
      if (!multisig) return;

      // wait a bit for contract to be available, can be improved
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await indexContract(multisig.ownerId, multisig.height);
    } catch (e) {
      // nothing is lost here: the periodic pass covers the same transaction, and its watermark does
      // not move past a multisig that failed for a reason a later attempt can get past
      logError('initWebsocket[message]', e);
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

// the height the next pass starts at - see SyncState for why it is not the newest signer's height
const nextHeight = async () => {
  const state = await SyncState.findByPk(SYNC_STATE_ID);
  if (state) return state.scannedHeight;

  // first start after this was introduced - carry the old watermark over rather than rescan the
  // whole chain to arrive at the same place
  const signer = await Signer.findOne({ order: [['height', 'DESC']] });
  return signer ? signer.height : 0;
};

const setScannedHeight = (scannedHeight) => SyncState.upsert({ id: SYNC_STATE_ID, scannedHeight });

// passes in a row a multisig has failed for a retryable reason - see MAX_TRANSIENT_ATTEMPTS
const transientAttempts = new Map();

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

// `indexContract` throws for most of what the pass looks at, and the two reasons have to be kept
// apart - see `isTransientError`.
const indexMultisig = async (ownerId, height) => {
  try {
    await indexContract(ownerId, height);
    transientAttempts.delete(ownerId);
    return 'indexed';
  } catch (e) {
    if (!isTransientError(e)) {
      // there will be cases that we check, but not of our contract, that then throw, ignore them
      logError('indexSigners[indexContract]', ownerId, e.message);
      process.stdout.write('-');
      return 'skipped';
    }

    const attempts = transientAttempts.get(ownerId) ?? 0;
    if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
      logError('indexSigners[indexContract]', ownerId, `still failing after ${attempts} passes, moving on without it:`, e.message);
      return 'abandoned';
    }

    logError('indexSigners[indexContract]', ownerId, 'failed for a reason a later pass can get past, keeping it for retry:', e.message);
    return 'retry';
  }
};

const fetchPage = async (url) => {
  const res = await fetch(`${process.env.MIDDLEWARE_URL}${url}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!res.ok) throw Object.assign(new Error(`middleware answered ${url} with ${res.status}`), { statusCode: res.status });
  const { data, next } = await res.json();
  if (!Array.isArray(data)) throw new Error(`middleware answered ${url} without a list of transactions`);
  return { data, next };
};

const indexSigners = async (height = 0) => {
  let url = `/v2/txs?scope=gen:${height}-${Number.MAX_SAFE_INTEGER}&direction=forward&type=paying_for&limit=${MIDDLEWARE_PAGE_LIMIT}`;

  let scanned = height;
  let persisted = height;
  let blocked = false;
  let indexed = 0;
  let answered = 0;
  const toRetry = new Set();

  while (url) {
    let data;
    let next;
    try {
      ({ data, next } = await fetchPage(url));
    } catch (e) {
      logError('indexSigners[fetchFromMiddleware]', url, e);
      throw e;
    }

    noteProgress();

    for (const tx of data) {
      const multisig = filterTx(tx);
      if (multisig) {
        const outcome = await indexMultisig(multisig.ownerId, multisig.height);

        // a page full of multisigs can take longer than the age `/health` accepts, and the pass
        // getting through them one by one is exactly the progress the probe is looking for
        noteProgress();

        if (outcome === 'indexed') indexed += 1;
        if (outcome === 'indexed' || outcome === 'skipped') answered += 1;
        if (outcome === 'retry') {
          blocked = true;
          toRetry.add(multisig.ownerId);
        }
      }

      // the middleware answers in forward order, so everything reached before the first multisig
      // that has to be retried is covered up to the height of that transaction
      if (!blocked) scanned = tx.block_height;
    }

    if (scanned > persisted) {
      await setScannedHeight(scanned);
      persisted = scanned;
    }

    if (next === url) throw new Error(`middleware paginates in a loop at ${url}`);
    url = next;
  }

  if (answered > 0) for (const ownerId of toRetry) transientAttempts.set(ownerId, (transientAttempts.get(ownerId) ?? 0) + 1);

  console.log(`scanned to ${scanned}, indexed ${indexed}${toRetry.size ? `, ${toRetry.size} to retry` : ''}`);
};

const createDBIfNotExists = async () => {
  await Signer.sync();
  await Tx.sync();
  await SyncState.sync();

  await migrate();
};

const cleanDB = async () => {
  await Signer.sync({ force: true });
  await Tx.sync({ force: true });
  await SyncState.sync({ force: true });
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
    matches = await authTxHashMatches(hash, tx, gaMetaParams, { onNode: node });
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
  MAX_TRANSIENT_ATTEMPTS,
  cleanDB,
  filterTx,
  createDBIfNotExists,
  indexSigners,
  nextHeight,
  getLastProgress,
  initClient,
  initWebsocket,
  createTransaction,
};
