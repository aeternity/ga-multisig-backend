const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGaMetaParams, InvalidGaMetaParamsError } = require('../src/util');

test('parseGaMetaParams', async (t) => {
  await t.test('treats a request without either value as one that sends no params', () => {
    assert.equal(parseGaMetaParams({}), undefined);
    assert.equal(parseGaMetaParams({ fee: null, gasPrice: null }), undefined);
    assert.equal(parseGaMetaParams({ hash: 'th_1', tx: 'tx_1' }), undefined);
  });

  await t.test('rejects one value without the other, either way around', () => {
    assert.throws(() => parseGaMetaParams({ fee: '100' }), InvalidGaMetaParamsError);
    assert.throws(() => parseGaMetaParams({ gasPrice: '100' }), InvalidGaMetaParamsError);
    assert.throws(() => parseGaMetaParams({ fee: '100', gasPrice: null }), InvalidGaMetaParamsError);
  });

  await t.test('accepts a pair as numbers or as decimal strings, and returns strings', () => {
    assert.deepEqual(parseGaMetaParams({ fee: 1e14, gasPrice: 1e9 }), { fee: '100000000000000', gasPrice: '1000000000' });
    assert.deepEqual(parseGaMetaParams({ fee: '100000000000000', gasPrice: '1000000000' }), { fee: '100000000000000', gasPrice: '1000000000' });
    assert.deepEqual(parseGaMetaParams({ fee: 0, gasPrice: 0 }), { fee: '0', gasPrice: '0' });
  });

  // the reason the parser takes strings at all: a wallet on a network with a raised fee sends an
  // amount a json number can't carry, and a value silently rounded here verifies against a hash
  // no wallet ever built
  await t.test('keeps an amount above Number.MAX_SAFE_INTEGER exactly', () => {
    const fee = '100000000000000000000001';
    assert.equal(parseGaMetaParams({ fee, gasPrice: '1' }).fee, fee);
  });

  await t.test('rejects anything that is not a non-negative integer amount', () => {
    for (const value of [-1, 1.5, '1.5', '-1', '', ' 1', '1 ', '0x10', '1e14', 1e21, NaN, Infinity, true, [], {}, '١٢٣']) {
      assert.throws(() => parseGaMetaParams({ fee: value, gasPrice: '1' }), InvalidGaMetaParamsError, `fee ${String(value)} should be rejected`);
      assert.throws(() => parseGaMetaParams({ fee: '1', gasPrice: value }), InvalidGaMetaParamsError, `gasPrice ${String(value)} should be rejected`);
    }
  });

  await t.test('names the offending value', () => {
    assert.throws(() => parseGaMetaParams({ fee: 'x', gasPrice: '1' }), /^InvalidGaMetaParamsError: fee /);
    assert.throws(() => parseGaMetaParams({ fee: '1', gasPrice: 'x' }), /^InvalidGaMetaParamsError: gasPrice /);
  });
});
