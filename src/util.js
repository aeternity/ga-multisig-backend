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

module.exports = {
  HashAlreadyExistentError,
  TxUnpackFailedError,
  TxHashNotMatchingError,
};
