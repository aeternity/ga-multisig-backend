const express = require('express');
const cors = require('cors');
const { isEncoded, Encoding } = require('@aeternity/aepp-sdk');
const { TxUnpackFailedError, TxHashNotMatchingError, HashAlreadyExistentError, InvalidGaMetaParamsError, parseGaMetaParams, logError } = require('./util');

// The routes take their persistence and their chain access as parameters so that they can be
// exercised without a database and without a node - see `test/app.test.js`.
const createApp = ({ getStatus, getLastProgress, maxProgressAge = 10 * 60 * 1000, createTransaction, findTx, findSigners }) => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // 503 once the indexer stopped hearing back - see `lastProgressAt` in logic.js
  app.get('/health', (req, res) => {
    const lastProgress = getLastProgress();
    const stale = Date.now() - lastProgress > maxProgressAge;
    res.status(stale ? 503 : 200).json({ status: getStatus(), lastProgress: new Date(lastProgress).toISOString() });
  });

  app.post('/tx', async (req, res) => {
    if (!req.body?.hash || !req.body?.tx) {
      return res.status(400).json({ error: 'request body has to contain hash and tx' });
    }

    let gaMetaParams;
    try {
      gaMetaParams = parseGaMetaParams(req.body);
    } catch (e) {
      if (!(e instanceof InvalidGaMetaParamsError)) throw e;
      return res.status(400).json({ error: e.message });
    }

    try {
      await createTransaction(req.body.hash, req.body.tx, gaMetaParams);
      return res.sendStatus(204);
    } catch (e) {
      if (e instanceof HashAlreadyExistentError) return res.status(409).json({ error: e.message });
      if (e instanceof TxUnpackFailedError || e instanceof TxHashNotMatchingError) return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  app.get('/tx/:hash', async (req, res) => {
    const tx = await findTx(req.params.hash);

    if (tx) return res.json(tx);
    else return res.sendStatus(404);
  });

  app.get('/:signerId', async (req, res) => {
    if (!isEncoded(req.params.signerId, Encoding.AccountAddress)) {
      return res.status(400).json({ error: 'request has to be in format /:signerId and valid signer account' });
    }

    res.json(await findSigners({ signerId: req.params.signerId, fromHeight: req.query.fromHeight }));
  });

  app.get('/', async (req, res) => {
    res.json(await findSigners({}));
  });

  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    // express marks the body errors it raises itself - malformed json, one over the size limit - as safe to show
    if (e.expose === true) return res.status(e.status).json({ error: e.message });
    logError(e);
    res.sendStatus(500);
  });

  return app;
};

module.exports = { createApp };
