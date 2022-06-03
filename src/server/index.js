const cron = require('node-cron');
const { indexSigners, initClient, cleanDB, nextTxi } = require('./logic');
const express = require('express');
const Signer = require('./Signer');

let running = false;

const start = async () => {
  //await cleanDB();
  await initClient();
  const txi = await nextTxi();

  cron.schedule('* * * * *', () => {
    if (!running) {
      running = true;
      indexSigners(txi)
        .then(() => (running = false))
        .catch(() => (running = false));
    } else console.log('already running');
  });

  const app = express();
  const port = 3000;

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
