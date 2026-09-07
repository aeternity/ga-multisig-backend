const test = require('node:test');
const assert = require('node:assert/strict');

// `logic` reads its endpoints and the database connection at import time
process.env.MIDDLEWARE_URL ??= 'https://testnet.aeternity.io/mdw';
process.env.NODE_URL ??= 'https://testnet.aeternity.io';
for (const name of ['PG_USER', 'PG_PASSWORD', 'PG_HOST', 'PG_DB']) process.env[name] ??= 'test';
process.env.PG_PORT ??= '5432';

const { filterTx, createTransaction } = require('../src/logic');
const { TxUnpackFailedError } = require('../src/util');

// as the middleware reports a multisig deployment: the GAAttachTx of the multisig contract, paid
// for by another account
const gaAttach = (owner) => ({
  block_height: 42,
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

test('createTransaction refuses a tx that does not unpack, before reaching node or the database', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  for (const tx of ['', 'not a transaction', 'tx_deadbeef']) {
    await assert.rejects(createTransaction('abc', tx), TxUnpackFailedError, `${tx} should not be stored`);
  }
});
