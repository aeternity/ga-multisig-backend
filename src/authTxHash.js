const { buildAuthTxHash, getCachedProtocolParameters, getFloorGasPrice, ArgumentError, IllegalArgumentError } = require('@aeternity/aepp-sdk');

// The GaMetaTx `fee`/`gasPrice` every wallet used while the sdk priced them by the constants of
// its own release. Since sdk@15 a wallet prices them by what the connected node reports, so they
// follow the network and this pair is only what a wallet built against an older sdk would have
// used - see `authTxHashMatches`.
const LEGACY_GA_META_PARAMS = { fee: 1e14, gasPrice: 1e9 };

// Gas a GaMetaTx is priced by: a wallet on sdk@15 takes `gasPrice` from the floor node reports -
// the higher of its consensus and miner minimums - and pays `gasPrice` times this as `fee`. The
// legacy pair is what that came out to back when the price came from the sdk release instead, so
// the two agree wherever that floor is still 1e9, as on mainnet and testnet.
const GA_META_TX_FEE_GAS = 100000n;

const gaMetaParamsFor = (gasPrice) => ({ fee: (BigInt(gasPrice) * GA_META_TX_FEE_GAS).toString(), gasPrice: gasPrice.toString() });

// A `gasPrice` below the floor node reports can't be part of a GaMetaTx node would accept, and a
// `fee` that isn't an amount can't be part of one at all - both make a hash that doesn't match
// rather than a failure to check it, so the next candidate is tried instead.
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

  // the legacy pair again wherever the floor is 1e9, and each check costs a request to node
  const gasPrice = getFloorGasPrice(await getCachedProtocolParameters(onNode));
  if (gasPrice === BigInt(LEGACY_GA_META_PARAMS.gasPrice)) return false;
  return matchesAuthTxHash(hash, tx, gaMetaParamsFor(gasPrice), onNode);
};

module.exports = {
  LEGACY_GA_META_PARAMS,
  authTxHashMatches,
};
