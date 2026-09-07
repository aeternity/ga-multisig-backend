const { buildAuthTxHash, getCachedProtocolParameters, ArgumentError, IllegalArgumentError } = require('@aeternity/aepp-sdk');

// The GaMetaTx `fee`/`gasPrice` every wallet used while the sdk priced them by the constants of
// its own release. Since sdk@15 a wallet prices them by what the connected node reports, so they
// follow a fee raise on the network and this pair is only what a wallet built against an older sdk
// would have used - see `authTxHashMatches`.
const LEGACY_GA_META_PARAMS = { fee: 1e14, gasPrice: 1e9 };

// A `gasPrice` below the consensus minimum node reports can't be part of a GaMetaTx node would
// accept, and a `fee` that isn't an amount can't be part of one at all - both make a hash that
// doesn't match rather than a failure to check it, so the next candidate is tried instead.
const matchesAuthTxHash = async (hash, tx, gaMetaParams, onNode) => {
  try {
    return (await buildAuthTxHash(tx, { onNode, ...gaMetaParams })).toString('hex') === hash;
  } catch (e) {
    if (e instanceof ArgumentError || e instanceof IllegalArgumentError) return false;
    throw e;
  }
};

// The auth hash binds `hash` to `tx`, so a transaction can't be stored under the hash of an
// unrelated one. It depends on the GaMetaTx `fee`/`gasPrice` the wallet built with, which since
// sdk@15 follow the node rather than an sdk constant - see README "Storing a transaction".
const authTxHashMatches = async (hash, tx, gaMetaParams, { onNode }) => {
  if (gaMetaParams != null) return matchesAuthTxHash(hash, tx, gaMetaParams, onNode);

  if (await matchesAuthTxHash(hash, tx, LEGACY_GA_META_PARAMS, onNode)) return true;

  const { minGasPrice, minMinerGasPrice } = await getCachedProtocolParameters(onNode);
  const gasPrices = [...new Set([minGasPrice, minMinerGasPrice])].filter((gasPrice) => gasPrice > BigInt(LEGACY_GA_META_PARAMS.gasPrice));
  for (const gasPrice of gasPrices) {
    if (await matchesAuthTxHash(hash, tx, { fee: LEGACY_GA_META_PARAMS.fee, gasPrice: gasPrice.toString() }, onNode)) return true;
  }
  return false;
};

module.exports = {
  LEGACY_GA_META_PARAMS,
  authTxHashMatches,
};
