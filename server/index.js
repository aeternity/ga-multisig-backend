const cron = require('node-cron');
const { indexSigners, initClient, cleanDB, nextHeight, initWebsocket } = require('./logic');
const express = require('express');
const Signer = require('./Signer');

let running = true;

const sync = (height) => {
  return indexSigners(height)
    .then(() => (running = false))
    .catch(() => (running = false));
};

const start = async () => {
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

  const app = express();
  const port = 3000;

  app.use( (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    next();
  });


  app.get('/:signerId', async (req, res) => {
    res.send(await Signer.findAll({ where: { signerId: req.params.signerId } }));
  });

  app.get('/', async (req, res) => {
    res.send(await Signer.findAll());
  });

  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
};

void start();
