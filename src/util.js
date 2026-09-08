class HashAlreadyExistentError extends Error {
  name = 'HashAlreadyExistentError';

  constructor() {
    super('hash already existent');
  }
}

class TxUnpackFailedError extends Error {
  name = 'TxUnpackFailedError';

  constructor() {
    super('transaction unpack failed');
  }
}

class TxHashNotMatchingError extends Error {
  name = 'TxHashNotMatchingError';

  constructor() {
    super('transaction not matching hash');
  }
}

class InvalidGaMetaParamsError extends Error {
  name = 'InvalidGaMetaParamsError';
}

// Amounts in aettos are big enough to lose precision as a json number, so they are accepted as
// decimal strings as well and kept as strings from here on.
function parseAettos(name, value) {
  const amount = typeof value === 'number' ? value.toString() : value;
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) throw new InvalidGaMetaParamsError(`${name} has to be a non-negative integer amount in aettos`);
  return amount;
}

// `fee` and `gasPrice` are the GaMetaTx values the auth hash is derived from. They are optional -
// a wallet that doesn't send them is checked against the values it would have used - but they only
// make sense as a pair: checking one wallet-provided value against one assumed default would verify
// the hash of a transaction no wallet ever built.
function parseGaMetaParams({ fee, gasPrice }) {
  if (fee == null && gasPrice == null) return undefined;
  if (fee == null || gasPrice == null) throw new InvalidGaMetaParamsError('fee and gasPrice have to be provided together');
  return { fee: parseAettos('fee', fee), gasPrice: parseAettos('gasPrice', gasPrice) };
}

// Codes node hands out for a connection that never got established, got cut, or timed out.
const TRANSIENT_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EHOSTDOWN'];

// Tells a failure a later attempt can get past - the node was unreachable, timed out, or answered
// 5xx - from one that will fail the same way every time. Deliberately narrow: a failure wrongly
// called permanent is only handled the way every failure was handled before, while one wrongly
// called transient holds the indexer's watermark back.
function isTransientError(error) {
  // fetch and the sdk both report the underlying network failure as the `cause` of a wrapper error
  for (let e = error, depth = 0; e != null && depth < 5; e = e.cause, depth += 1) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    if (TRANSIENT_ERROR_CODES.includes(e.code)) return true;
    const status = e.statusCode ?? e.response?.status;
    if (typeof status === 'number' && status >= 500) return true;
  }
  return false;
}

// a value that parses to NaN would read as "no limit" everywhere it is used, so it is refused rather than defaulted
function positiveMsFromEnv(name) {
  if (!process.env[name]) return undefined;
  const value = Number(process.env[name]);
  if (!(value > 0)) throw new Error(`${name} has to be a positive number of milliseconds`);
  return value;
}

function logError(...error) {
  console.log('Error:\n');
  console.error(...error);
}

module.exports = {
  HashAlreadyExistentError,
  TxUnpackFailedError,
  TxHashNotMatchingError,
  InvalidGaMetaParamsError,
  parseGaMetaParams,
  isTransientError,
  positiveMsFromEnv,
  logError,
};
