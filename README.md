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
of the node it is connected to rather than by the constants of an sdk release, so the values move
with the network and the backend can't assume them. A request that omits them is verified against
the pair every wallet used before, and against the pair each minimum the node reports would give —
so a wallet built against an older sdk keeps working, but one that prices its own way has to say
which price it used.

## Indexing

The backend finds new multisig accounts two ways: a middleware websocket that reports them as they
are deployed, and a pass over the middleware once a minute that catches whatever the websocket
missed. The pass starts from the height everything below which is known to be indexed, which it
keeps in the `SyncStates` table - not from the newest signer it stored, because a multisig that
failed to index would then be skipped for good as soon as a later one moved the watermark past it.

A multisig that could not be indexed because the node was unreachable, timed out, or answered 5xx
holds the watermark at its height so the next pass comes back for it. One that failed for any other
reason is passed over - most paying_for transactions are not multisig deployments at all, and those
are expected to fail here.

To rescan a range - after an incident that left multisigs unindexed, say - move the watermark back
and let the next pass pick it up. Indexing is idempotent, so rescanning costs time and nothing else.

```sql
UPDATE "SyncStates" SET "scannedHeight" = <height to rescan from> WHERE id = 1;
```

`GET /health` answers 503 once the indexer has not heard back from the middleware or the node for
`MAX_PROGRESS_AGE_MS`. Point the liveness probe at it: a request that hangs otherwise leaves the
process up and answering while nothing is indexed any more. Allow more than one pass worth of time
before the probe gives up on a container.

## Environment

| Variable                                                | Default  |                                                                 |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `PG_USER`, `PG_PASSWORD`, `PG_HOST`, `PG_PORT`, `PG_DB` |          | the database, all required                                      |
| `NODE_URL`, `MIDDLEWARE_URL`                            |          | the chain endpoints, both required, no trailing slash           |
| `REQUEST_TIMEOUT_MS`                                    | `30000`  | deadline for every node and middleware request                  |
| `MAX_PROGRESS_AGE_MS`                                   | `600000` | how long `/health` stays green without the indexer hearing back |
