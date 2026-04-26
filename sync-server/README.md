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

The server creates or migrates its table and indexes automatically on startup.
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

Client configuration:

```env
SYNC_API_URL=https://gf.cook1ek1ng.xyz/api/sync
SYNC_TOKEN=your-sync-token
```
