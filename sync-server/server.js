const http = require('http');
require('dotenv').config();
const { Pool } = require('pg');

const port = Number(process.env.PORT || 3017);
const syncToken = process.env.SYNC_TOKEN || '';
const databaseUrl = process.env.DATABASE_URL || '';

if (!syncToken) {
  throw new Error('SYNC_TOKEN is required');
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: databaseUrl,
});

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== syncToken) {
    sendJson(res, 401, { error: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const payload = record.payload && typeof record.payload === 'object'
    ? record.payload
    : record;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : typeof payload.id === 'string' && payload.id.trim()
      ? payload.id.trim()
      : '';

  if (!id) {
    return null;
  }

  const updatedAtMs = Math.max(
    toMillis(record.updatedAtMs),
    toMillis(record.updatedAt),
    toMillis(payload.updatedAt),
    toMillis(payload.contentUpdatedAt)
  );

  return {
    id,
    updatedAtMs,
    deleted: record.deleted === true || payload.deleted === true,
    payload: {
      ...payload,
      id,
    },
  };
}

async function handleSync(req, res) {
  if (!requireAuth(req, res)) {
    return;
  }

  let input;
  try {
    input = await readJson(req);
  } catch (_error) {
    sendJson(res, 400, { error: 'INVALID_JSON' });
    return;
  }

  const deviceId =
    typeof input.deviceId === 'string' && input.deviceId.trim()
      ? input.deviceId.trim()
      : 'unknown-device';
  const records = Array.isArray(input.records) ? input.records : [];

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const item of records) {
      const record = normalizeRecord(item);
      if (!record) {
        continue;
      }

      await client.query(
        `
          insert into question_records
            (id, updated_at_ms, deleted, payload, source_device, server_updated_at)
          values
            ($1, $2, $3, $4::jsonb, $5, now())
          on conflict (id) do update set
            updated_at_ms = excluded.updated_at_ms,
            deleted = excluded.deleted,
            payload = excluded.payload,
            source_device = excluded.source_device,
            server_updated_at = now()
          where excluded.updated_at_ms >= question_records.updated_at_ms
        `,
        [
          record.id,
          record.updatedAtMs,
          record.deleted,
          JSON.stringify(record.payload),
          deviceId,
        ]
      );
    }

    const result = await client.query(
      `
        select payload
        from question_records
        order by updated_at_ms desc, id asc
      `
    );
    await client.query('commit');

    sendJson(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      records: result.rows.map((row) => row.payload),
    });
  } catch (error) {
    await client.query('rollback');
    console.error(error);
    sendJson(res, 500, { error: 'SYNC_FAILED' });
  } finally {
    client.release();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sync') {
    void handleSync(req, res);
    return;
  }

  sendJson(res, 404, { error: 'NOT_FOUND' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`WrongBook sync server listening on ${port}`);
});
