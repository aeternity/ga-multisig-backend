const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGaMetaParams, isTransientError, positiveMsFromEnv, InvalidGaMetaParamsError } = require('../src/util');

test('isTransientError', async (t) => {
  await t.test('accepts what a later attempt can get past', () => {
    const cases = [
      Object.assign(new Error('timed out'), { name: 'AbortError' }),
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      Object.assign(new Error('getaddrinfo'), { code: 'EAI_AGAIN' }),
      Object.assign(new Error('node is unwell'), { statusCode: 503 }),
      Object.assign(new Error('node is unwell'), { response: { status: 500 } }),
      // fetch and the sdk report the network failure underneath a wrapper error
      Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) }),
    ];

    for (const e of cases) assert.equal(isTransientError(e), true, `${e.name}/${e.code ?? e.statusCode} should be retried`);
  });

  // the common case by far: a paying_for transaction that deployed a generalized account which is
  // not one of our multisigs. Calling that transient would pin the watermark to its height.
  await t.test('rejects what will fail the same way every time', () => {
    const cases = [
      undefined,
      null,
      new Error('Invalid contract address'),
      Object.assign(new Error('not found'), { statusCode: 404 }),
      Object.assign(new Error('bad request'), { response: { status: 400 } }),
      new TypeError('cannot read properties of null'),
    ];

    for (const e of cases) assert.equal(isTransientError(e), false, `${e} should not be retried`);
  });

  await t.test('survives an error whose cause chain is circular', () => {
    const e = new Error('a');
    e.cause = e;
    assert.equal(isTransientError(e), false);
  });
});

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

test('positiveMsFromEnv', async (t) => {
  t.after(() => delete process.env.PROBE_MS);

  await t.test('is unset for a variable that is missing or empty', () => {
    delete process.env.PROBE_MS;
    assert.equal(positiveMsFromEnv('PROBE_MS'), undefined);
    process.env.PROBE_MS = '';
    assert.equal(positiveMsFromEnv('PROBE_MS'), undefined);
  });

  await t.test('parses a value in milliseconds', () => {
    process.env.PROBE_MS = '1500';
    assert.equal(positiveMsFromEnv('PROBE_MS'), 1500);
  });

  await t.test('refuses a value that is not a positive number', () => {
    for (const value of ['abc', '0', '-1', 'NaN']) {
      process.env.PROBE_MS = value;
      assert.throws(() => positiveMsFromEnv('PROBE_MS'), /PROBE_MS has to be a positive number/, `${value} should be refused`);
    }
  });
});
