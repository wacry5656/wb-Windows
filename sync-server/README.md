# WrongBook PostgreSQL Sync Server

This is the single VPS sync backend for the Windows and Android wrong-book apps.
It uses Node.js and PostgreSQL.

## Environment

Copy `.env.example` to `.env` on the VPS and fill in real values:

```env
PORT=3017
SYNC_TOKEN=
DATABASE_URL=postgres://wrongbook:replace-password@127.0.0.1:5432/wrongbook
```

Use a long random `SYNC_TOKEN`. Do not commit `.env`.

## Database

Create the PostgreSQL user and database first:

```sql
CREATE USER wrongbook WITH PASSWORD 'replace-password';
CREATE DATABASE wrongbook OWNER wrongbook;
```

The server creates or migrates its table, revision sequence, and indexes
automatically on startup. The migration is idempotent and keeps all existing
records. `npm run init-db` is optional; a normal restart after deployment is
enough.
Manual initialization is only needed if you want to pre-create the schema:

```bash
cd /opt/wrongbook/sync-server
npm install --omit=dev
npm run init-db
```

## Start

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:3017/health
```

Sync endpoint:

```text
POST /api/sync
Authorization: Bearer <SYNC_TOKEN>
Content-Type: application/json
```

Capability probe (same URL, no snapshot download):

```bash
curl -i -X OPTIONS \
  -H 'Authorization: Bearer <SYNC_TOKEN>' \
  https://example.com/api/sync
```

Protocol v2 uses small `push` batches followed by paged `pull` requests. It
supports gzip request/response bodies, opaque snapshot cursors, permanent
compact deletion markers, canonical single-copy image data, and mergeable
review events. Protocol v1 remains available for already-installed clients.
See [PROTOCOL_V2.md](./PROTOCOL_V2.md) for the wire contract and compatibility
rules.

## Limits and tombstones

Defaults can be changed on the VPS when needed:

```env
SYNC_MAX_REQUEST_BYTES=16777216
SYNC_MAX_DECOMPRESSED_BYTES=50331648
SYNC_MAX_RESPONSE_BYTES=50331648
SYNC_TARGET_PAGE_BYTES=8388608
SYNC_DEFAULT_PAGE_LIMIT=100
SYNC_MAX_PAGE_LIMIT=250
TOMBSTONE_COMPACT_AFTER_DAYS=0
```

An oversized request receives a real HTTP `413` JSON response. Deleted records
and their restorable content are retained by default. Keep
`TOMBSTONE_COMPACT_AFTER_DAYS=0` in production when the recycle-bin restore
promise must remain lossless. A positive value deliberately removes large
content and image fields after that many days while retaining the small
deletion marker, so it should only be enabled with an explicit irreversible
retention policy. The legacy `TOMBSTONE_RETENTION_DAYS` variable is still read
as a compact age, but it no longer physically deletes markers.

## Validation

```bash
npm ci
npm run test:merge
node --check server.js
```

`test:merge` runs merge/protocol regression tests and HTTP boundary tests. A
real PostgreSQL staging backup is still recommended before the first VPS
upgrade.

If Nginx is in front of Node, it must forward authenticated `OPTIONS` and
`POST` requests on `/api/sync`. Its compressed request limit must be at least
the advertised `SYNC_MAX_REQUEST_BYTES` (for the defaults, use a little
headroom such as `client_max_body_size 20m`). Keep proxy read/send timeouts at
120 seconds or more. The v2 8 MiB page target and small push batches make those
timeouts a safety net instead of part of the normal data path.

Client configuration:

```env
SYNC_API_URL=https://gf.cook1ek1ng.xyz/api/sync
SYNC_TOKEN=your-sync-token
```
