const cron = require('node-cron');
const { indexSigners, initClient, nextHeight, getLastProgress, initWebsocket, createDBIfNotExists, createTransaction } = require('./logic');

const Signer = require('./db/Signer');
const { Op } = require('sequelize');
const Tx = require('./db/Tx');
const { logError, positiveMsFromEnv } = require('./util');
const { createApp } = require('./app');

const maxProgressAge = positiveMsFromEnv('MAX_PROGRESS_AGE_MS');

let running = true;
let status = 'started';

process.on('unhandledRejection', (e) => {
  console.log('unhandledRejection', e);
});

process.on('uncaughtException', (e) => {
  console.log('uncaughtException', e);
});

const sync = (height) => {
  console.log('starting sync from', height);
  return indexSigners(height)
    .then(() => (running = false))
    .catch((e) => {
      logError(e);
      running = false;
    });
};

const initialize = async () => {
  await createDBIfNotExists();
  await initClient();

  // sync first, then init websocket
  await sync(await nextHeight());
  await initWebsocket();

  // sync periodically to ensure latest info
  cron.schedule('* * * * *', async () => {
    if (!running) {
      running = true;
      await sync(await nextHeight());
    } else console.log('already running');
  });
};

const start = async () => {
  void initialize().then(() => (status = 'synced'));

  const port = 3000;
  const app = createApp({
    getStatus: () => status,
    getLastProgress,
    maxProgressAge,
    createTransaction,
    findTx: (hash) => Tx.findOne({ where: { hash } }),
    findSigners: ({ signerId, fromHeight }) =>
      Signer.findAll({
        where: {
          ...(fromHeight ? { height: { [Op.gte]: fromHeight } } : {}),
          ...(signerId ? { signerId } : {}),
        },
      }),
  });

  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
};

void start();
