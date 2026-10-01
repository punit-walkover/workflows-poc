// Creates the POC database if missing, then applies migrations/*.sql once each, in order.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  // Managed Postgres (Render) already has the database and may not allow connecting to "postgres".
  try {
    const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
    await admin.connect();
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!rowCount) {
      await admin.query(`create database "${dbName}"`);
      console.log(`created database ${dbName}`);
    }
    await admin.end();
  } catch (e) {
    console.log(`skipping database creation (${e.message})`);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const done = await db.query('select 1 from schema_migrations where name = $1', [file]);
    if (done.rowCount) continue;
    await db.query('begin');
    await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await db.query('insert into schema_migrations (name) values ($1)', [file]);
    await db.query('commit');
    console.log(`applied ${file}`);
  }
  await db.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
