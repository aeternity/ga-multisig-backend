# Multisig Backend

This is the optional backend for ux optimization to use the [ga-multisig-ui](https://github.com/aeternity/ga-multisig-ui). It indexes multisig accounts per signer and exposes a key-value storage for transaction hash to raw transaction. In the future a signature challenge is to be added to some endpoints.

## Get started

Clone repo via git or use the template button above.

Requires Node.js 20.19 or newer and a PostgreSQL database.

Install the dependencies

```
npm install
```

Copy `.env_sample` to `.env` and point it at your database, the node and the middleware, then run
the backend

```
npm run server
```

## Development

```
npm test           # unit and http tests, no database or node needed
npm run format     # prettier
```

## Storing a transaction

`POST /tx` stores a raw transaction under the hash the multisig signers sign, and verifies that the
hash really is the one of that transaction before storing it.

```json
{
  "hash": "<Auth.tx_hash as hex>",
  "tx": "tx_...",
  "fee": "100000000000000",
  "gasPrice": "1000000000"
}
```

`fee` and `gasPrice` are the GaMetaTx values the wallet derived the hash from, in aettos, as a
decimal string or a number. They are optional and only accepted as a pair.

Send them: since `@aeternity/aepp-sdk@15` a wallet prices a transaction by the consensus parameters
and the demand of the node it is connected to rather than by the constants of an sdk release, so the
values move with the network and the backend can't assume them. A request that omits them is
verified against the pair every wallet used before, and against the minimums the node reports — so
a wallet built against an older sdk keeps working across a fee raise, but one that picks its own
price has to say which price it used.
