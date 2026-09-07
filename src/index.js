const cron = require('node-cron');
const { indexSigners, initClient, nextHeight, initWebsocket, createDBIfNotExists, createTransaction } = require('./logic');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const Signer = require('./db/Signer');
const { Op } = require('sequelize');
const Tx = require('./db/Tx');
const { isEncoded, Encoding } = require('@aeternity/aepp-sdk');
const { TxUnpackFailedError, TxHashNotMatchingError, HashAlreadyExistentError, InvalidGaMetaParamsError, parseGaMetaParams, logError } = require('./util');

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
  //await cleanDB();
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

  const app = express();
  const port = 3000;

  app.use(cors());
  app.use(bodyParser.json());

  app.get('/health', async (req, res) => {
    return res.json({ status });
  });

  app.post('/tx', async (req, res) => {
    if (!req.body.hash || !req.body.tx) {
      res.status(400);
      return res.json({ error: 'request body has to contain hash and tx' });
    }

    let gaMetaParams;
    try {
      gaMetaParams = parseGaMetaParams(req.body);
    } catch (e) {
      if (!(e instanceof InvalidGaMetaParamsError)) throw e;
      res.status(400);
      return res.json({ error: e.message });
    }

    return createTransaction(req.body.hash, req.body.tx, gaMetaParams)
      .then(() => res.sendStatus(204))
      .catch((e) => {
        if (e instanceof HashAlreadyExistentError) {
          res.status(409);
          return res.json({ error: e.message });
        } else if (e instanceof TxUnpackFailedError || e instanceof TxHashNotMatchingError) {
          res.status(400);
          return res.json({ error: e.message });
        } else {
          logError(e);
          return res.sendStatus(500);
        }
      });
  });

  app.get('/tx/:hash', async (req, res) => {
    if (!req.params.hash) {
      res.status(400);
      return res.json({ error: 'request has to be in format /tx/:hash' });
    }
    const tx = await Tx.findOne({ where: { hash: req.params.hash } });

    if (tx) return res.json(tx);
    else return res.sendStatus(404);
  });

  app.get('/:signerId', async (req, res) => {
    if (!req.params.signerId || !isEncoded(req.params.signerId, Encoding.AccountAddress)) {
      res.status(400);
      return res.json({ error: 'request has to be in format /:signerId and valid signer account' });
    }

    const fromHeight = req.query.fromHeight;

    return res.json(
      await Signer.findAll({
        where: {
          ...(fromHeight ? { height: { [Op.gte]: fromHeight } } : {}),
          signerId: req.params.signerId,
        },
      }),
    );
  });

  app.get('/', async (req, res) => {
    return res.json(await Signer.findAll());
  });

  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
};

void start();
