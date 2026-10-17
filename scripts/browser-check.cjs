const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const root = process.cwd();
const artifacts =
  process.env.TEST_ARTIFACT_DIR ||
  fs.mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "mimi-browser-"),
  );
fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const appRequire = createRequire(root + "/package.json");
const { chromium } = appRequire("playwright");
const postgres = appRequire("postgres");
const { parse } = appRequire("dotenv");
const { compare } = appRequire("bcryptjs");
const settings = {
  ...(fs.existsSync(root + "/.env")
    ? parse(fs.readFileSync(root + "/.env"))
    : {}),
  ...process.env,
};
const sql = postgres(process.env.POSTGRES_URL || settings.POSTGRES_URL);
const base = process.env.TEST_BASE_URL;
if (
  !base ||
  !settings.POSTGRES_URL ||
  !settings.AUTH_SECRET ||
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
  !["127.0.0.1", "localhost"].includes(new URL(settings.POSTGRES_URL).hostname)
)
  throw new Error("Explicit loopback synthetic browser fixtures required.");
const email = `mimi-check-${crypto.randomBytes(6).toString("hex")}@example.test`;
const password = crypto.randomBytes(18).toString("hex");
const nextPassword = crypto.randomBytes(18).toString("hex");
let browser;

(async () => {
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => {
    const entry = { message: e.message, stack: e.stack, route: page.url() };
    errors.push(entry);
    console.error("CLIENT_ERROR", JSON.stringify(entry));
  });
  const visit = async (route) => {
    const response = await page.goto(base + route, {
      waitUntil: "networkidle",
    });
    assert.equal(response.status(), 200, route);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      route + " overflows",
    );
  };

  await visit("/");
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").textContent(), "Skip to content");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(":focus").getAttribute("id"), "main-content");
  assert.equal(await page.locator(".hero").count(), 1);
  await page.screenshot({
    path: artifacts + "/mimi-home-desktop.png",
    fullPage: true,
  });
  await visit("/discover");
  assert.equal(await page.locator(".creator-card").count(), 6);
  await page
    .getByRole("searchbox", { name: "Search the creator directory" })
    .fill("  YUKI ");
  assert.equal(await page.locator(".creator-card").count(), 1);
  await page.getByRole("button", { name: "Cosplay", exact: true }).click();
  await page.getByRole("heading", { name: "A little quiet here" }).waitFor();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  assert.equal(await page.locator(".creator-card").count(), 6);
  await page.getByLabel("Sort creators").selectOption("name");
  assert.equal(
    await page.locator(".creator-card h3").first().textContent(),
    "Kai Studio",
  );
  await page
    .locator(".creator-card")
    .filter({ has: page.getByRole("heading", { name: "Yuki Bloom" }) })
    .getByRole("button", { name: "Follow", exact: true })
    .click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page
      .locator(".creator-card")
      .filter({ has: page.getByRole("heading", { name: "Yuki Bloom" }) })
      .getByRole("button", { name: "Following", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({
    path: artifacts + "/mimi-discover-desktop.png",
    fullPage: true,
  });
  await visit("/following");
  assert.equal(await page.locator(".post-card").count(), 2);
  console.log(
    "PASS: keyboard skip link, directory search/category/reset/sort, follow persistence, Following",
  );

  await visit("/feed");
  await page
    .getByRole("button", { name: "Like A little Sunday softness", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Unlike A little Sunday softness",
        exact: true,
      })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "Save A little Sunday softness", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Comments on A little Sunday softness",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Add a demo comment on A little Sunday softness")
    .fill("A lovely local-only test comment.");
  await page
    .getByRole("button", { name: "Add demo comment", exact: true })
    .click();
  await page
    .getByText("A lovely local-only test comment.", { exact: false })
    .waitFor();
  await page
    .getByRole("button", {
      name: "More options for post by Yuki Bloom",
      exact: true,
    })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: "Report post (demo)", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.ok(
    (await dialog.textContent()).includes("not sent to a moderation team"),
  );
  if (true) {
    await page.addScriptTag({
      path: appRequire.resolve("axe-core/axe.min.js"),
    });
    const dialogAudit = await page.evaluate(() =>
      axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );
    assert.deepEqual(dialogAudit.violations, []);
    console.log("PASS: report dialog accessibility");
  }
  assert.equal(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    true,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", {
      name: "More options for post by Yuki Bloom",
      exact: true,
    })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: "Report post (demo)", exact: true })
    .click();
  await page.getByLabel("Reason", { exact: true }).selectOption("Spam");
  await page
    .getByLabel("Anything else?", { exact: false })
    .fill("Local test draft; do not submit.");
  await page
    .getByRole("button", { name: "Save demo report", exact: true })
    .click();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mimi-community-demo-v1")),
  );
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].reason, "Spam");
  await visit("/creators/yukibloom");
  assert.equal(
    await page
      .getByRole("button", { name: "Payments are unavailable", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: artifacts + "/mimi-profile-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "More options for Yuki Bloom", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Block creator (demo)", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Yuki Bloom is blocked", exact: true })
    .waitFor();
  await visit("/following");
  assert.equal(await page.locator(".post-card").count(), 0);
  await visit("/creators/yukibloom");
  await page
    .getByRole("button", { name: "Unblock demo creator", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Yuki Bloom", exact: true })
    .waitFor();
  await visit("/feed");
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  assert.equal(await page.locator("video").count(), 1);
  await page.locator("video").evaluate((video) => video.play());
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.2,
  );
  await page.locator("video").evaluate((video) => video.pause());
  await visit("/notifications");
  await page
    .getByRole("button", { name: "Mark preview as read", exact: true })
    .click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page
      .getByRole("button", { name: "All caught up", exact: true })
      .isDisabled(),
    true,
  );
  console.log(
    "PASS: likes, comments, saves, report focus/Escape/local draft, block/unblock, membership disabled, playable video, notification persistence",
  );

  await visit("/sign-up?redirect=checkout&priceId=disabled-payment-check");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.waitForURL(base + "/dashboard");
  await page
    .getByRole("heading", { name: "Hello, lovely human.", exact: true })
    .waitFor();
  let user = await page.evaluate(async () => (await fetch("/api/user")).json());
  assert.equal(user.email, email);
  assert.equal("passwordHash" in user, false);
  const team = await page.evaluate(async () =>
    (await fetch("/api/team")).json(),
  );
  assert.ok(team.teamMembers.some((member) => member.user.id === user.id));
  assert.equal(team.stripeSubscriptionId, null);
  await visit("/dashboard/saved");
  assert.equal(await page.locator(".post-card").count(), 1);
  await page
    .getByRole("heading", { name: "A little Sunday softness", exact: true })
    .waitFor();
  await visit("/dashboard/creator-tools");
  await page
    .getByLabel("Give your idea a little name")
    .fill("A local creative idea");
  await page.getByLabel("Tell a little story").fill("Not a published post.");
  await page
    .getByRole("button", { name: "Save a local draft", exact: true })
    .click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.getByLabel("Give your idea a little name").inputValue(),
    "A local creative idea",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Publishing unavailable", exact: true })
      .isDisabled(),
    true,
  );
  await visit("/dashboard/general");
  await page.getByLabel("Name", { exact: true }).fill("Mimi Verification");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page
    .getByText("Account updated successfully.", { exact: true })
    .waitFor();
  const [stored] =
    await sql`select name,password_hash from users where email=${email}`;
  assert.equal(stored.name, "Mimi Verification");
  assert.ok(await compare(password, stored.password_hash));
  await visit("/profile");
  await page
    .getByRole("heading", { name: "Mimi Verification", exact: true })
    .waitFor();
  await visit("/dashboard/team");
  await page
    .getByRole("heading", { name: "Team Settings", exact: true })
    .waitFor();
  await visit("/dashboard/security");
  await page.getByLabel("Current Password", { exact: true }).fill(password);
  await page.getByLabel("New Password", { exact: true }).fill(nextPassword);
  await page
    .getByLabel("Confirm New Password", { exact: true })
    .fill(nextPassword);
  await page
    .getByRole("button", { name: "Update Password", exact: true })
    .click();
  await page
    .getByText("Password updated successfully.", { exact: true })
    .waitFor();
  await visit("/dashboard/activity");
  await page.getByText("You changed your password", { exact: true }).waitFor();
  console.log(
    "PASS: registration, saved posts, local creator draft, real profile update, private profile, workspace preservation, password change, audit log",
  );
  if (true) {
    for (const route of [
      "/dashboard",
      "/dashboard/general",
      "/dashboard/security",
      "/dashboard/creator-tools",
      "/profile",
      "/dashboard/saved",
    ]) {
      await visit(route);
      await page.addScriptTag({
        path: appRequire.resolve("axe-core/axe.min.js"),
      });
      const audit = await page.evaluate(() =>
        axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        }),
      );
      assert.deepEqual(audit.violations, []);
      console.log("PASS: account accessibility " + route);
    }
  }
  const routes = [
    "/",
    "/discover",
    "/feed",
    "/creators/yukibloom",
    "/following",
    "/notifications",
    "/profile",
    "/settings",
    "/dashboard/saved",
    "/dashboard/creator-tools",
    "/dashboard/security",
    "/community-guidelines",
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of routes) {
    await visit(route);
    await page.addScriptTag({
      path: appRequire.resolve("axe-core/axe.min.js"),
    });
    const mobileAudit = await page.evaluate(() =>
      axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );
    assert.deepEqual(
      mobileAudit.violations,
      [],
      route + " mobile accessibility",
    );
    if (route !== "/settings")
      assert.equal(await page.locator(".mobile-navigation a").count(), 6);
    if (
      ["/", "/creators/yukibloom", "/dashboard/creator-tools"].includes(route)
    )
      await page.screenshot({
        path:
          artifacts +
          "/mimi-" +
          (route === "/"
            ? "home"
            : route.includes("creators/")
              ? "profile"
              : "studio") +
          "-mobile.png",
        fullPage: true,
      });
  }
  await page
    .getByRole("button", { name: "Open account menu", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.waitForURL(base + "/");
  await visit("/sign-in?redirect=checkout&priceId=disabled-payment-check");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByText("Invalid email or password. Please try again.", { exact: true })
    .waitFor();
  await page.getByLabel("Password", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(base + "/dashboard");
  await page
    .getByRole("heading", { name: "Hello, Mimi.", exact: true })
    .waitFor();
  const response = await context.request.get(
    base + "/creators/no-such-creator",
  );
  assert.equal(response.status(), 404);
  if (process.env.TEST_STAGING_ENV_FILE && process.env.TEST_STAGING_BASE_URL) {
    const stageSettings = parse(
      fs.readFileSync(process.env.TEST_STAGING_ENV_FILE),
    );
    const stageContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      httpCredentials: {
        username: stageSettings.STAGING_ACCESS_USERNAME,
        password: stageSettings.STAGING_ACCESS_PASSWORD,
      },
      extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
    });
    const stage = await stageContext.newPage();
    const r = await stage.goto(process.env.TEST_STAGING_BASE_URL + "/sign-up", {
      waitUntil: "networkidle",
    });
    assert.equal(r.status(), 200);
    assert.match(r.headers()["x-robots-tag"], /noindex/);
    await stage
      .getByRole("heading", {
        name: "Registration is unavailable",
        exact: true,
      })
      .waitFor();
    await stage
      .getByRole("complementary", { name: "Private staging environment" })
      .waitFor();
    await stage.addScriptTag({
      path: appRequire.resolve("axe-core/axe.min.js"),
    });
    const a = await stage.evaluate(() =>
      axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      }),
    );
    assert.deepEqual(a.violations, []);
    assert.equal(
      await stage.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    console.log(
      "PASS: private staging access, closed signup, environment indicator and mobile accessibility",
    );
    await stage.goto(process.env.TEST_STAGING_BASE_URL + "/", {
      waitUntil: "networkidle",
    });
    await stage.locator(".hero").waitFor();
    await stage.waitForFunction(() =>
      Array.from(document.images)
        .filter(
          (img) =>
            img.loading !== "lazy" ||
            img.getBoundingClientRect().top < innerHeight,
        )
        .every((img) => img.complete),
    );
    assert.equal(
      await stage.evaluate(() =>
        Array.from(document.images)
          .filter(
            (img) =>
              img.loading !== "lazy" ||
              img.getBoundingClientRect().top < innerHeight,
          )
          .every((img) => img.naturalWidth > 0),
      ),
      true,
      "Authorized staging illustrations load through the site gate",
    );
    console.log(
      "PASS: authorized staging homepage and protected illustration delivery",
    );
    await stageContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all mobile navigation routes without overflow, sign-out, old-password rejection, new-password login, unknown creator 404; no browser errors",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    await sql.begin(async (tx) => {
      const members =
        await tx`select team_id from team_members where user_id in (select id from users where email=${email})`;
      for (const { team_id } of members) {
        await tx`delete from invitations where team_id=${team_id}`;
        await tx`delete from activity_logs where team_id=${team_id}`;
        await tx`delete from team_members where team_id=${team_id}`;
        await tx`delete from teams where id=${team_id}`;
      }
      const accounts = await tx`select id from users where email=${email}`;
      const subjects = [];
      for (const [scope, values] of [
        ["signup_email", [email]],
        ["signin_email", [email]],
        ["account", accounts.map((a) => String(a.id))],
      ])
        for (const value of values)
          subjects.push(
            crypto
              .createHmac("sha256", settings.AUTH_SECRET)
              .update(scope + ":" + value)
              .digest("hex"),
          );
      await tx`delete from auth_rate_limits where subject_hash=any(${subjects}::text[])`;
      await tx`delete from users where email=${email}`;
    });
    await sql.end();
    console.log("Temporary Mimi verification account and team removed.");
  });
