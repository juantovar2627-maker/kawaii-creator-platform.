import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile),
  url = process.env.TEST_DATABASE_URL;
test(
  "operational diagnostics detect stale workers/cleanup and maintenance does not fabricate success",
  { skip: !url },
  async () => {
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    );
    const { stdout } = await run(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
 import assert from 'node:assert/strict';
 import {randomUUID,randomBytes} from 'node:crypto';
 import {sql} from 'drizzle-orm';
 import {db,client} from './lib/db/drizzle.ts';
 import {diagnostics} from './lib/ops/health.ts';
 import {startCleanup,finishCleanup,pruneAuthWindows} from './lib/ops/maintenance.ts';
 const worker=randomUUID();let run;const subject=randomBytes(32).toString('hex');
 try {
  const existing=await db.execute(sql\`select service from service_runs where service='media_cleanup'\`);
  assert.equal(existing.length,0,'Use the documented disposable test database, without an operational cleanup row.');
  let health=await diagnostics();assert.equal(health.checks.database.status,'ready');assert.equal(health.checks.cleanup.status,'unverified');
  await db.execute(sql\`insert into video_workers(id,status,heartbeat_at) values(\${worker}::uuid,'idle',now())\`);
  health=await diagnostics();assert.equal(health.checks.worker.status,'ready');
  await db.execute(sql\`update video_workers set heartbeat_at=now()-interval '5 minutes' where id=\${worker}::uuid\`);
  health=await diagnostics();assert.equal(health.checks.worker.status,'stale');
  run=await startCleanup();await assert.rejects(()=>startCleanup());await finishCleanup(run,false);
  health=await diagnostics();assert.equal(health.checks.cleanup.status,'failed');
  await finishCleanup(run,true);health=await diagnostics();assert.equal(health.checks.cleanup.status,'ready');
  await db.execute(sql\`update service_runs set finished_at=now()-interval '20 minutes' where run_id=\${run}::uuid\`);
  health=await diagnostics();assert.equal(health.checks.cleanup.status,'stale');
  await db.execute(sql\`insert into auth_rate_limits(scope,subject_hash,started_at) values('expiry_fixture',\${subject},now()-interval '25 hours')\`);
  await pruneAuthWindows();assert.equal((await db.execute(sql\`select scope from auth_rate_limits where subject_hash=\${subject}\`)).length,0);
  const text=JSON.stringify(health);assert.equal(text.includes(process.env.AUTH_SECRET),false);assert.equal(text.includes(process.env.MEDIA_LOCAL_ROOT),false);assert.equal(text.includes(process.env.POSTGRES_URL),false);
  console.log('Operational status transitions and bounded authentication-window retention verified.');
 } finally {
  if(run)await db.execute(sql\`delete from service_runs where run_id=\${run}::uuid\`);
  await db.execute(sql\`delete from video_workers where id=\${worker}::uuid\`);
  await db.execute(sql\`delete from auth_rate_limits where scope='expiry_fixture' and subject_hash=\${subject}\`);
  await client.end();
 }
 `,
      ],
      { env: { ...process.env, POSTGRES_URL: url }, timeout: 30000 },
    );
    assert.match(stdout, /verified/);
  },
);
