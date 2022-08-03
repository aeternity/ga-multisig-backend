const cron = require('node-cron');
const { indexSigners, initClient, cleanDB, nextHeight, initWebsocket } = require('./logic');
const express = require('express');
const bodyParser = require('body-parser');

const Signer = require('./Signer');
const { Op } = require('sequelize');
const Tx = require('./Tx');

let running = true;

process.on('unhandledRejection', (e) => {
  console.log('unhandledRejection', e);
});

process.on('uncaughtException', (e) => {
  console.log('uncaughtException', e);
});

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

  app.use(bodyParser.json());
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    next();
  });

  app.post('/tx', async (req, res) => {
    await Tx.create({ hash: req.body.hash, data: req.body.data })
      .then(() => res.sendStatus(204))
      .catch((e) => {
        if (e.errors?.some((e) => e.validatorKey === 'not_unique')) res.sendStatus(409);
        else {
          console.error(e);
          res.sendStatus(500);
        }
      });
  });

  app.get('/tx/:hash', async (req, res) => {
    const tx = await Tx.findOne({ hash: req.params.hash });
    if (tx) res.send(tx);
    else res.sendStatus(404);
  });

  app.get('/:signerId', async (req, res) => {
    let fromHeight = req.query.fromHeight;

    res.send(
      await Signer.findAll({
        where: {
          ...(fromHeight ? { height: { [Op.gte]: fromHeight } } : {}),
          signerId: req.params.signerId,
        },
      }),
    );
  });

  app.get('/', async (req, res) => {
    res.send(await Signer.findAll());
  });

  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
};

void start();
