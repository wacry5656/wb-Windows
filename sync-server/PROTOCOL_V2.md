# WrongBook sync protocol v2

Protocol v2 keeps `POST /api/sync` and the existing bearer token. It separates
upload and download so a large library never needs one 50 MB full-duplex
request. Protocol v1 remains supported during rollout.

## Capability probe

Send authenticated `OPTIONS` to the exact configured sync URL. A v2 server
returns HTTP 200, `X-WrongBook-Sync-Protocol: 2`, and:

```json
{
  "ok": true,
  "protocolVersion": 2,
  "protocolVersions": [1, 2],
  "preferredProtocolVersion": 2,
  "capabilities": [
    "push-pull-v2",
    "paged-snapshot-v1",
    "canonical-images-v1",
    "review-events-v1",
    "permanent-tombstones-v1",
    "gzip-v1"
  ],
  "maxRequestBytes": 16777216,
  "maxDecompressedBytes": 50331648,
  "maxResponseBytes": 50331648,
  "targetPageBytes": 8388608,
  "defaultPageLimit": 100,
  "maxPageLimit": 250
}
```

A 404 or a response without v2 means the VPS is still v1. Clients may use one
legacy request only after a conservative size check; large libraries must ask
the user to upgrade the server.

## Push

Clients split records below both advertised byte limits and may set
`Content-Encoding: gzip`:

```json
{
  "protocolVersion": 2,
  "mode": "push",
  "deviceId": "windows-device",
  "records": []
}
```

Response:

```json
{
  "ok": true,
  "protocolVersion": 2,
  "mode": "push",
  "acceptedCount": 0,
  "ignoredCount": 0,
  "changedCount": 0,
  "compactedCount": 0,
  "generation": "42",
  "serverTime": "2026-07-16T00:00:00.000Z"
}
```

v2 rejects the whole batch with `400 INVALID_RECORDS` before opening a database
transaction if any record has no usable id. It never partially accepts an
invalid batch.

## Pull

After all pushes, request pages until `snapshotComplete` is true:

```json
{
  "protocolVersion": 2,
  "mode": "pull",
  "deviceId": "windows-device",
  "cursor": null,
  "limit": 100,
  "maxBytes": 8388608
}
```

Response:

```json
{
  "ok": true,
  "protocolVersion": 2,
  "mode": "pull",
  "generation": "42",
  "records": [],
  "nextCursor": null,
  "snapshotComplete": true,
  "serverTime": "2026-07-16T00:00:00.000Z"
}
```

`generation` is a decimal string and `nextCursor` is opaque. Empty `records` is
a valid complete snapshot. If the database changes between pages, the server
returns `409 SNAPSHOT_STALE`; discard collected pages and restart with a null
cursor. Only a complete snapshot may replace the local synced baseline. Local
mutations made after the upload snapshot must then be replayed.

## Delete and restore

- `deleted: true` plus `deletedAt` is a permanent marker.
- Content, note, review, AI, and follow-up timestamps never restore a record.
- Restore is explicit: set `deleted: false` and `restoredAt`; it wins only when
  `restoredAt > deletedAt`.
- Deleted payloads and their restorable content are retained indefinitely by
  default. Optional operator-enabled compaction never removes the marker, but
  it is intentionally lossy: the compact marker retains `id`, `title`,
  `category`, `createdAt`, `updatedAt`, `deletedAt`, and
  `tombstoneCompacted: true` so v1 and v2 clients can still parse it.

## Images

Canonical payloads contain `imageRefs` and `noteImageRefs`; the legacy `image`
and `noteImages` base64 copies are not stored. Each inline ref uses:

```json
{
  "id": "img-0123456789abcdef0123456789abcdef",
  "storage": "inline",
  "mimeType": "image/jpeg",
  "dataUrl": "data:image/jpeg;base64,...",
  "contentHash": "0123456789abcdef...64 lowercase hex characters"
}
```

`contentHash` is SHA-256 of decoded image bytes, not the data URL string. The
server accepts an input `sha256:` prefix but emits plain lowercase hex. A hash
mismatch or unreadable local file is unavailable data and cannot replace a good
server image.

List updates use `imageRefsUpdatedAt` / `noteImageRefsUpdatedAt` and
`imageRefsComplete` / `noteImageRefsComplete`. Only a complete list with a
strictly newer group timestamp may replace or clear an existing list. A failed
read sends `complete: false` (or omits the group), so it can never mean clear.
Hash-derived ids prevent different bytes with the same client id from
overwriting one another.

## Review events

Review count is derived from an append-only union:

```json
{
  "reviewEvents": [
    {
      "id": "review-uuid",
      "kind": "review",
      "reviewedAt": "2026-07-16T00:00:00.000Z",
      "quality": 2,
      "deviceId": "android-device"
    },
    {
      "id": "revert-uuid",
      "kind": "revert",
      "reviewedAt": "2026-07-16T00:01:00.000Z",
      "targetEventId": "review-uuid"
    }
  ]
}
```

Events union/deduplicate by stable id. Quality 0 is an attempt but does not
increase `reviewCount`; quality 1-3 does. A revert cancels its target. Existing
numeric counts become deterministic `legacy-review:<questionId>:<ordinal>`
events, so two upgraded devices do not double the history. A v1 client that
returns only a larger count contributes only the positive difference.

Merged scheduling is replayed deterministically. Successful counts 1/2/3/4/5+
map to 1/3/7/14/30 days; quality 0 retries in 10 minutes, quality 1 in one day,
quality 2 uses the normal interval, and quality 3 doubles it. A later explicit
postpone (`reviewUpdatedAt` newer than every event) may override only the next
review date.

## Errors

- `400 INVALID_JSON`, `INVALID_CURSOR`, `INVALID_RECORDS`, or
  `INVALID_SYNC_MODE`
- `401 UNAUTHORIZED`
- `409 SNAPSHOT_STALE`
- `413 REQUEST_TOO_LARGE`, `DECOMPRESSED_REQUEST_TOO_LARGE`,
  `RECORD_TOO_LARGE`, or `LEGACY_RESPONSE_TOO_LARGE`
- `415 UNSUPPORTED_CONTENT_ENCODING`
- `500 SYNC_FAILED`

Error bodies are JSON and include advertised byte limits where useful.
