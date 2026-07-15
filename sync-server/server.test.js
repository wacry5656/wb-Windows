const assert = require('assert/strict');
const http = require('http');
const zlib = require('zlib');
const { createServer } = require('./server');

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || Buffer.alloc(0);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: options.path || '/api/sync',
        method: options.method || 'GET',
        headers: {
          ...(body.length > 0 ? { 'content-length': String(body.length) } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const decoded =
            res.headers['content-encoding'] === 'gzip'
              ? zlib.gunzipSync(raw)
              : raw;
          let json = null;
          try {
            json = JSON.parse(decoded.toString('utf8'));
          } catch (_error) {
            // Tests assert JSON only where the route promises it.
          }
          resolve({ status: res.statusCode, headers: res.headers, json, raw });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  const token = 'test-token';
  const fakeDatabase = {
    connectCount: 0,
    async connect() {
      this.connectCount += 1;
      return {
        async query(statement) {
          const sql = String(statement).replace(/\s+/g, ' ').trim().toLowerCase();
          if (sql.includes('coalesce(max(revision)')) {
            return { rows: [{ generation: '0' }] };
          }
          if (sql.includes('select id, payload')) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const server = createServer(fakeDatabase, token, {
    limits: {
      maxRequestBytes: 1024,
      maxDecompressedBytes: 1024,
      maxResponseBytes: 4096,
      targetPageBytes: 2048,
      defaultPageLimit: 10,
      maxPageLimit: 20,
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const health = await request(port, { path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(health.json.protocolVersion, 2);
    assert.deepEqual(health.json.protocolVersions, [1, 2]);
    assert.ok(health.json.capabilities.includes('push-pull-v2'));

    const unauthorized = await request(port, {
      method: 'OPTIONS',
      headers: { authorization: 'Bearer wrong-token' },
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.json.error, 'UNAUTHORIZED');

    const capabilities = await request(port, {
      method: 'OPTIONS',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.headers['x-wrongbook-sync-protocol'], '2');
    assert.equal(capabilities.json.maxRequestBytes, 1024);
    assert.equal(capabilities.json.defaultPageLimit, 10);

    const validPushBody = Buffer.from(
      JSON.stringify({
        protocolVersion: 2,
        mode: 'push',
        deviceId: 'http-test',
        records: [],
      })
    );
    const validPush = await request(port, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: zlib.gzipSync(validPushBody),
    });
    assert.equal(validPush.status, 200);
    assert.equal(validPush.json.mode, 'push');
    assert.equal(validPush.json.acceptedCount, 0);
    assert.equal(validPush.json.generation, '0');

    const emptyPull = await request(port, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: Buffer.from(
        JSON.stringify({ protocolVersion: 2, mode: 'pull', cursor: null })
      ),
    });
    assert.equal(emptyPull.status, 200);
    assert.deepEqual(emptyPull.json.records, []);
    assert.equal(emptyPull.json.snapshotComplete, true);
    assert.equal(emptyPull.json.nextCursor, null);

    const connectCountBeforeInvalid = fakeDatabase.connectCount;
    const invalidBatch = await request(port, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: Buffer.from(
        JSON.stringify({ protocolVersion: 2, mode: 'push', records: [{}] })
      ),
    });
    assert.equal(invalidBatch.status, 400);
    assert.equal(invalidBatch.json.error, 'INVALID_RECORDS');
    assert.equal(invalidBatch.json.invalidRecordCount, 1);
    assert.equal(fakeDatabase.connectCount, connectCountBeforeInvalid);

    const oversized = await request(port, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: Buffer.from('x'.repeat(2048)),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.json.error, 'REQUEST_TOO_LARGE');
    assert.equal(oversized.json.maxRequestBytes, 1024);

    const compressedBomb = zlib.gzipSync(
      Buffer.from(JSON.stringify({ records: ['x'.repeat(4096)] }))
    );
    const decompressedTooLarge = await request(port, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: compressedBomb,
    });
    assert.equal(decompressedTooLarge.status, 413);
    assert.equal(decompressedTooLarge.json.error, 'DECOMPRESSED_REQUEST_TOO_LARGE');

    const invalidGzip = await request(port, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: Buffer.from('not gzip'),
    });
    assert.equal(invalidGzip.status, 400);
    assert.equal(invalidGzip.json.error, 'INVALID_GZIP');

    const notFound = await request(port, { path: '/missing' });
    assert.equal(notFound.status, 404);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }

  console.log('server HTTP tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
