import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
test("CI output redacts split secrets, JWTs, Basic credentials and database URLs while preserving failure status", async () => {
  const secret = randomBytes(32).toString("hex"),
    token =
      "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjp7ImlkIjoxMjM0NTZ9fQ." +
      randomBytes(32).toString("base64url");
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "scripts/ci-run.mjs",
        process.execPath,
        "-e",
        `process.stdout.write(process.env.AUTH_SECRET.slice(0,11));setTimeout(()=>{process.stdout.write(process.env.AUTH_SECRET.slice(11)+'\\n'+process.env.FIXTURE_JWT+'\\nBasic c3ludGhldGljOnByaXZhdGU=\\npostgres://user:private@database/staging\\nbenign check\\n');process.stderr.write('x'.repeat(70000)+'\\n');process.exitCode=7;},20);`,
      ],
      { env: { ...process.env, AUTH_SECRET: secret, FIXTURE_JWT: token } },
    );
    assert.fail("The failed child must not pass.");
  } catch (error) {
    assert.equal(error.code, 7);
    const output = error.stdout + error.stderr;
    for (const value of [
      secret,
      token,
      "c3ludGhldGljOnByaXZhdGU=",
      "postgres://user:private",
    ])
      assert.equal(output.includes(value), false);
    assert.match(output, /benign check/);
    assert.match(output, /oversized CI output withheld/);
  }
});
