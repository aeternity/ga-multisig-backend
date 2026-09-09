const test = require('node:test');
const assert = require('node:assert/strict');

const { authTxHashMatches } = require('../src/authTxHash');

// A SpendTx and the `Auth.tx_hash` values a wallet on `ae_uat` derives from it, recorded from the
// sdk so that an sdk upgrade that changes the derivation fails here instead of silently rejecting
// every transaction the deployed wallets send.
const TX = 'tx_+FkMAaEB4TK48d23oE5jt/qWR5pUu8UlpTGn8bwM5JISGQMGf7ChAfdeU/V4IiJ6WLRjCV1tq2V8q4BFdL5i3gvh+VJ50JA3iA3gtrOnZAAAhg9MNiAIAAABgAfc0jY=';
const HASH_LEGACY = '29fb6ddc9991bb9e2e03ae8e16919819bc3b608f3ba8550308d370adda642453';
const HASH_FEE_2E14_GAS_PRICE_2E9 = '37d9f514a26fbab585adc7764015541009ba35663ff73648305116472ed9e0fa';
const HASH_FEE_1E11_GAS_PRICE_1E6 = 'db024d8045651297279a69f075a1fadead861e1c228a2ef16f011d4b7357b979';
const HASH_FEE_2E14_GAS_PRICE_3E9 = 'e90cff3157630b360b21d703a6e8f3eead5e29cfd9938591a2fe2c958a62704f';

// Only the calls the hash derivation makes: the network id it binds the transaction to, and - when
// the double reports them - the consensus parameters the GaMetaTx `gasPrice` is checked against.
// A double without the parameter endpoints stands for a node the sdk falls back to its own release
// values for, which are the ones the legacy pair was priced by.
const nodeDouble = ({ minGasPrice, minMinerGasPrice } = {}) => ({
  getNodeInfo: async () => ({ nodeNetworkId: 'ae_uat' }),
  ...(minGasPrice == null
    ? {}
    : {
        getProtocolParameters: async () => ({
          currentProtocolVersion: 6,
          protocols: [{ version: 6, minimumGasPrice: minGasPrice, gasPerByte: 20, txBaseGas: {}, contractTxBaseGas: [], stateGasPerBlock: {} }],
        }),
        getNodeSettings: async () => ({ minMinerGasPrice: minMinerGasPrice ?? minGasPrice, blockGasLimit: 6e6, maxAuthFunGas: 50000 }),
      }),
});

test('authTxHashMatches', async (t) => {
  await t.test('accepts the hash of the pair a wallet sends explicitly', async () => {
    const onNode = nodeDouble({ minGasPrice: 2000000000n, minMinerGasPrice: 3000000000n });
    assert.equal(await authTxHashMatches(HASH_FEE_2E14_GAS_PRICE_3E9, TX, { fee: '200000000000000', gasPrice: '3000000000' }, { onNode }), true);
  });

  // the point of accepting the pair from the request: without it, a wallet pricing by a node that
  // raised its minimums has no way to be verified
  await t.test('rejects a hash built from another pair than the one sent', async () => {
    const onNode = nodeDouble();
    assert.equal(await authTxHashMatches(HASH_LEGACY, TX, { fee: '200000000000000', gasPrice: '3000000000' }, { onNode }), false);
  });

  await t.test('accepts the legacy pair when the request sends none', async () => {
    assert.equal(await authTxHashMatches(HASH_LEGACY, TX, undefined, { onNode: nodeDouble() }), true);
  });

  await t.test('falls back to the minimums node reports when the request sends none', async () => {
    const onNode = nodeDouble({ minGasPrice: 2000000000n });
    assert.equal(await authTxHashMatches(HASH_FEE_2E14_GAS_PRICE_2E9, TX, undefined, { onNode }), true);
    // the legacy `gasPrice` is below what this node accepts, so a hash derived from it can't be of
    // a transaction this network would take
    assert.equal(await authTxHashMatches(HASH_LEGACY, TX, undefined, { onNode }), false);
  });

  // what mainnet and testnet both report - a minimum below the price the sdk used to hardcode. The
  // candidate has to be tried on that side of the legacy price too, or every wallet on sdk@15 that
  // sends no pair is turned away.
  await t.test('falls back to a minimum below the legacy price', async () => {
    const onNode = nodeDouble({ minGasPrice: 1000000n });
    assert.equal(await authTxHashMatches(HASH_FEE_1E11_GAS_PRICE_1E6, TX, undefined, { onNode }), true);
  });

  await t.test('tries the miner minimum as well as the consensus one', async () => {
    const onNode = nodeDouble({ minGasPrice: 1000000000n, minMinerGasPrice: 2000000000n });
    assert.equal(await authTxHashMatches(HASH_FEE_2E14_GAS_PRICE_2E9, TX, undefined, { onNode }), true);
    assert.equal(await authTxHashMatches(HASH_LEGACY, TX, undefined, { onNode }), true);
  });

  await t.test('rejects the hash of an unrelated transaction', async () => {
    const onNode = nodeDouble();
    assert.equal(await authTxHashMatches('0'.repeat(64), TX, undefined, { onNode }), false);
    assert.equal(await authTxHashMatches(HASH_LEGACY.replace(/^2/, '3'), TX, undefined, { onNode }), false);
  });

  await t.test('rejects rather than throws on a pair no node would accept', async () => {
    const onNode = nodeDouble({ minGasPrice: 2000000000n });
    assert.equal(await authTxHashMatches(HASH_LEGACY, TX, { fee: '100000000000000', gasPrice: '1000000000' }, { onNode }), false);
    assert.equal(await authTxHashMatches(HASH_LEGACY, TX, { fee: 'not an amount', gasPrice: '2000000000' }, { onNode }), false);
  });

  // a node that can't be reached must not read as a hash that doesn't match: that would answer a
  // valid request with a 400 the wallet can do nothing about
  await t.test('propagates a failure to reach node', async () => {
    const onNode = {
      getNodeInfo: async () => {
        throw new Error('node unreachable');
      },
    };
    await assert.rejects(authTxHashMatches(HASH_LEGACY, TX, undefined, { onNode }), /node unreachable/);
  });
});
