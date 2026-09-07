const test = require('node:test');
const assert = require('node:assert/strict');

// `logic` reads its endpoints and the database connection at import time
process.env.MIDDLEWARE_URL ??= 'https://testnet.aeternity.io/mdw';
process.env.NODE_URL ??= 'https://testnet.aeternity.io';
for (const name of ['PG_USER', 'PG_PASSWORD', 'PG_HOST', 'PG_DB']) process.env[name] ??= 'test';
process.env.PG_PORT ??= '5432';

const { AeSdk, Contract } = require('@aeternity/aepp-sdk');
const { filterTx, createTransaction, indexSigners, initClient, MAX_TRANSIENT_ATTEMPTS } = require('../src/logic');
const Signer = require('../src/db/Signer');
const SyncState = require('../src/db/SyncState');
const { TxUnpackFailedError } = require('../src/util');

// as the middleware reports a multisig deployment: the GAAttachTx of the multisig contract, paid
// for by another account
const gaAttach = (owner, height = 42) => ({
  block_height: height,
  tx: { type: 'PayingForTx', tx: { tx: { type: 'GAAttachTx', owner_id: owner } } },
});

test('filterTx', async (t) => {
  await t.test('picks the owner and height out of a multisig deployment', () => {
    assert.deepEqual(filterTx(gaAttach('ak_owner')), { ownerId: 'ak_owner', height: 42 });
  });

  await t.test('ignores every other transaction the middleware reports', () => {
    const cases = [
      undefined,
      null,
      {},
      { tx: null },
      { tx: { type: 'SpendTx' } },
      // a PayingForTx paying for something else than a multisig deployment
      { block_height: 42, tx: { type: 'PayingForTx', tx: { tx: { type: 'SpendTx' } } } },
      // a GAAttachTx that is not wrapped in a PayingForTx
      { block_height: 42, tx: { type: 'GAAttachTx', owner_id: 'ak_owner' } },
      // no owner to index the signers of
      { block_height: 42, tx: { type: 'PayingForTx', tx: { tx: { type: 'GAAttachTx' } } } },
    ];

    for (const tx of cases) assert.equal(filterTx(tx), null, `${JSON.stringify(tx)} should be ignored`);
  });
});

// a transaction the scan walks past without touching node or the database
const spend = (height) => ({ block_height: height, tx: { type: 'SpendTx' } });

// drives `indexSigners` against a scripted middleware, recording the pages it asked for and the
// heights it wrote back. None of the transactions is a multisig deployment, so it needs no node.
const scan = async (t, pages) => {
  t.mock.method(console, 'log', () => {});
  const requested = [];
  const scanned = [];

  t.mock.method(SyncState, 'upsert', (values) => {
    scanned.push(values.scannedHeight);
    return Promise.resolve();
  });
  t.mock.method(global, 'fetch', (url) => {
    requested.push(url.replace(process.env.MIDDLEWARE_URL, ''));
    const { status = 200, ...body } = pages[requested.length - 1];
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  });

  return { requested, scanned };
};

test('indexSigners', async (t) => {
  await t.test('follows every page and records how far it got', async (t) => {
    const { requested, scanned } = await scan(t, [
      { data: [spend(101), spend(102)], next: '/v2/txs?cursor=second' },
      { data: [spend(103)], next: null },
    ]);

    await indexSigners(100);

    assert.equal(requested.length, 2);
    assert.match(requested[0], /scope=gen:100-/);
    assert.equal(requested[1], '/v2/txs?cursor=second');
    assert.deepEqual(scanned, [102, 103]);
  });

  // the watermark is what the next pass starts from, so it has to be asked for in a page big
  // enough that a rescan of a few weeks is not hundreds of round trips
  await t.test('asks for a page worth fetching', async (t) => {
    const { requested } = await scan(t, [{ data: [], next: null }]);

    await indexSigners(100);

    assert.match(requested[0], /limit=100\b/);
  });

  await t.test('leaves the watermark alone when there is nothing to scan', async (t) => {
    const { scanned } = await scan(t, [{ data: [], next: null }]);

    await indexSigners(100);

    assert.deepEqual(scanned, []);
  });

  await t.test('refuses a middleware that hands back the page it just answered', async (t) => {
    const url = '/v2/txs?cursor=stuck';
    const { requested } = await scan(t, [
      { data: [spend(101)], next: url },
      { data: [spend(101)], next: url },
    ]);

    await assert.rejects(indexSigners(100), /paginates in a loop/);
    assert.equal(requested.length, 2);
  });

  await t.test('reports a middleware that answers with an error status', async (t) => {
    t.mock.method(console, 'error', () => {});
    await scan(t, [{ status: 503 }]);

    await assert.rejects(indexSigners(100), /answered .* with 503/);
  });
});

const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
const notFound = () => Object.assign(new Error('Account not found'), { statusCode: 404 });

// drives passes of `indexSigners` over the same page of multisig deployments against a scripted
// node: `answers` maps an owner to the account node returns for it, or to the error it fails with
const indexing = async (t, txs, answers) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(process.stdout, 'write', () => true);
  await initClient();

  t.mock.method(global, 'fetch', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: txs, next: null }) }));
  t.mock.method(AeSdk.prototype, 'getAccount', (ownerId) => (answers[ownerId] instanceof Error ? Promise.reject(answers[ownerId]) : Promise.resolve(answers[ownerId])));
  t.mock.method(Contract, 'initialize', async () => ({
    get_version: async () => ({ decodedResult: 1n }),
    get_signers: async () => ({ decodedResult: ['ak_signer'] }),
  }));
  const stored = [];
  t.mock.method(Signer, 'bulkCreate', async (rows) => stored.push(...rows));
  const scanned = [];
  t.mock.method(SyncState, 'upsert', (values) => {
    scanned.push(values.scannedHeight);
    return Promise.resolve();
  });

  const passes = async (count) => {
    for (let i = 0; i < count; i += 1) await indexSigners(100);
  };
  return { stored, scanned, passes };
};

// the owner ids are unique per case: how often a multisig failed is kept across passes
test('indexSigners over multisig deployments', async (t) => {
  await t.test('indexes the signers, and moves the watermark past a deployment that is not our contract', async (t) => {
    const { stored, scanned, passes } = await indexing(t, [gaAttach('ak_ours', 100), gaAttach('ak_other', 101)], { ak_ours: { contractId: 'ct_ours' }, ak_other: notFound() });
    await passes(1);

    assert.deepEqual(
      stored.map((row) => [row.gaAccountId, row.contractId, row.signerId]),
      [['ak_ours', 'ct_ours', 'ak_signer']],
    );
    assert.deepEqual(scanned, [101]);
  });

  await t.test('holds the watermark at a multisig node did not answer for, while indexing the ones after it', async (t) => {
    const { stored, scanned, passes } = await indexing(t, [gaAttach('ak_unanswered', 100), gaAttach('ak_answered', 101)], { ak_unanswered: timeout(), ak_answered: { contractId: 'ct_answered' } });
    await passes(1);

    assert.deepEqual(
      stored.map((row) => row.gaAccountId),
      ['ak_answered'],
    );
    assert.deepEqual(scanned, []);
  });

  // node answering for the deployment after it - even to say it is not ours - is what shows the
  // failure is not an outage
  await t.test('passes a multisig over once it kept failing while node answered for another', async (t) => {
    const { scanned, passes } = await indexing(t, [gaAttach('ak_stuck', 100), gaAttach('ak_notours', 101)], { ak_stuck: timeout(), ak_notours: notFound() });

    await passes(MAX_TRANSIENT_ATTEMPTS);
    assert.deepEqual(scanned, []);
    await passes(1);
    assert.deepEqual(scanned, [101]);
  });

  await t.test('never gives up on a multisig while node answers for nothing', async (t) => {
    const { scanned, passes } = await indexing(t, [gaAttach('ak_down_1', 100), gaAttach('ak_down_2', 101)], { ak_down_1: timeout(), ak_down_2: timeout() });
    await passes(MAX_TRANSIENT_ATTEMPTS + 5);

    assert.deepEqual(scanned, []);
  });
});

test('createTransaction refuses a tx that does not unpack, before reaching node or the database', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  for (const tx of ['', 'not a transaction', 'tx_deadbeef']) {
    await assert.rejects(createTransaction('abc', tx), TxUnpackFailedError, `${tx} should not be stored`);
  }
});
