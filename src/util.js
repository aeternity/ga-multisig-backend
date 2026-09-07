class HashAlreadyExistentError extends Error {
  constructor() {
    super('hash already existent');
  }
}

class TxUnpackFailedError extends Error {
  constructor() {
    super('transaction unpack failed');
  }
}

class TxHashNotMatchingError extends Error {
  constructor() {
    super('transaction not matching hash');
  }
}

class InvalidGaMetaParamsError extends Error {}

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
  logError,
};
