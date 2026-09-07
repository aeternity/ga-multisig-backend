const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { createApp } = require('../src/app');
const { TxUnpackFailedError, TxHashNotMatchingError, HashAlreadyExistentError } = require('../src/util');

const SIGNER_ID = 'ak_2iBPH7HUz3cSDVEUWiHg76MZJ6tZooVNBmmxcgVK6VV8KAE688';

const start = async (t, deps = {}) => {
  const calls = [];
  const record =
    (name, result) =>
    (...args) => {
      calls.push([name, ...args]);
      return result;
    };

  const server = createApp({
    getStatus: () => 'synced',
    createTransaction: record('createTransaction'),
    findTx: record('findTx', null),
    findSigners: record('findSigners', []),
    ...deps,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    get: (path) => fetch(url + path),
    post: (path, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
  };
};

// silences the `logError` of the 500 case, and lets it be asserted on
const captureErrorLog = (t) => {
  const logged = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', (...args) => logged.push(args));
  return logged;
};

test('GET /health reports the sync status', async (t) => {
  const app = await start(t, { getStatus: () => 'started' });
  const res = await app.get('/health');

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'started' });
});

test('POST /tx', async (t) => {
  await t.test('stores a transaction and answers without a body', async (t) => {
    const app = await start(t);
    const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1' }));

    assert.equal(res.status, 204);
    assert.deepEqual(app.calls, [['createTransaction', 'abc', 'tx_1', undefined]]);
  });

  await t.test('passes a fee/gasPrice pair on as strings', async (t) => {
    const app = await start(t);
    const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1', fee: 1e14, gasPrice: '2000000000' }));

    assert.equal(res.status, 204);
    assert.deepEqual(app.calls, [['createTransaction', 'abc', 'tx_1', { fee: '100000000000000', gasPrice: '2000000000' }]]);
  });

  await t.test('rejects a request without hash or tx before reaching the store', async (t) => {
    const app = await start(t);

    for (const body of [{}, { hash: 'abc' }, { tx: 'tx_1' }, { hash: '', tx: 'tx_1' }]) {
      const res = await app.post('/tx', JSON.stringify(body));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: 'request body has to contain hash and tx' });
    }
    assert.deepEqual(app.calls, []);
  });

  await t.test('rejects half of a fee/gasPrice pair', async (t) => {
    const app = await start(t);
    const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1', fee: 1e14 }));

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'fee and gasPrice have to be provided together' });
    assert.deepEqual(app.calls, []);
  });

  await t.test('answers a malformed body with the status express refused it with', async (t) => {
    const app = await start(t);
    const res = await app.post('/tx', '{');

    assert.equal(res.status, 400);
    assert.equal(res.headers.get('content-type').startsWith('application/json'), true);
  });

  await t.test('maps a hash that is already stored to 409', async (t) => {
    const app = await start(t, { createTransaction: () => Promise.reject(new HashAlreadyExistentError()) });
    const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1' }));

    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'hash already existent' });
  });

  await t.test('maps a transaction that is not the one of the hash to 400', async (t) => {
    for (const error of [new TxUnpackFailedError(), new TxHashNotMatchingError()]) {
      const app = await start(t, { createTransaction: () => Promise.reject(error) });
      const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1' }));

      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: error.message });
    }
  });

  // a node outage or a database failure is not the client's mistake, and its message may name
  // internals - it must not be answered with a 4xx, and not be spelled out in the response
  await t.test('answers an unexpected failure with 500 and logs it', async (t) => {
    const logged = captureErrorLog(t);
    const app = await start(t, { createTransaction: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')) });
    const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1' }));

    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /ECONNREFUSED/);
    assert.equal(logged.length, 1);
  });

  // an error from node carries the status node answered with - it is not the client's mistake either
  await t.test('answers a node error that carries a 4xx status with 500, and logs it', async (t) => {
    const logged = captureErrorLog(t);
    const error = Object.assign(new Error('v3/accounts/ak_x error: Account not found'), { statusCode: 404 });
    const app = await start(t, { createTransaction: () => Promise.reject(error) });
    const res = await app.post('/tx', JSON.stringify({ hash: 'abc', tx: 'tx_1' }));

    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /Account not found/);
    assert.equal(logged.length, 1);
  });
});

test('GET /tx/:hash', async (t) => {
  await t.test('returns the stored transaction', async (t) => {
    const stored = { hash: 'abc', tx: 'tx_1' };
    const app = await start(t, { findTx: () => Promise.resolve(stored) });
    const res = await app.get('/tx/abc');

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), stored);
  });

  // `/tx/:hash` and `/:signerId` overlap, and a transaction hash is not a signer account
  await t.test('is a 404 for a hash that was never stored, without falling through to the signer route', async (t) => {
    const app = await start(t);
    const res = await app.get('/tx/abc');

    assert.equal(res.status, 404);
    assert.deepEqual(app.calls, [['findTx', 'abc']]);
  });
});

test('GET /:signerId', async (t) => {
  await t.test('returns the multisig accounts of a signer', async (t) => {
    const signers = [{ signerId: SIGNER_ID, height: 42 }];
    const app = await start(t, { findSigners: () => Promise.resolve(signers) });
    const res = await app.get(`/${SIGNER_ID}`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), signers);
  });

  await t.test('passes fromHeight through when it is given', async (t) => {
    const app = await start(t);

    await app.get(`/${SIGNER_ID}`);
    await app.get(`/${SIGNER_ID}?fromHeight=42`);

    assert.deepEqual(app.calls, [
      ['findSigners', { signerId: SIGNER_ID, fromHeight: undefined }],
      ['findSigners', { signerId: SIGNER_ID, fromHeight: '42' }],
    ]);
  });

  await t.test('rejects anything that is not an account address', async (t) => {
    const app = await start(t);

    for (const signerId of ['not-an-account', 'ct_2iBPH7HUz3cSDVEUWiHg76MZJ6tZooVNBmmxcgVK6VV8KAE688', `${SIGNER_ID}0`, 'ak_0']) {
      const res = await app.get(`/${encodeURIComponent(signerId)}`);
      assert.equal(res.status, 400, `${signerId} should be rejected`);
      assert.deepEqual(await res.json(), { error: 'request has to be in format /:signerId and valid signer account' });
    }
    assert.deepEqual(app.calls, []);
  });
});

test('GET / returns every indexed signer', async (t) => {
  const app = await start(t);
  const res = await app.get('/');

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
  assert.deepEqual(app.calls, [['findSigners', {}]]);
});

// the ui is served from another origin than the backend
test('answers with a permissive cors header', async (t) => {
  const app = await start(t);
  const res = await app.get('/health');

  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});
