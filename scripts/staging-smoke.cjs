// Works through HTTP/browser APIs only: no database credentials or reset/delete SQL.
const fs = require("node:fs");
const { randomBytes, randomUUID } = require("node:crypto");
const { chromium, request } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");
let browser,
  step = "input validation",
  scans = 0;
function check(value) {
  if (!value) throw new Error("check");
}
(async () => {
  const config = JSON.parse(
    fs.readFileSync(process.env.STAGING_SMOKE_FILE, "utf8"),
  );
  const url = new URL(config.baseUrl);
  check(
    url.origin === config.baseUrl &&
      url.origin === process.env.STAGING_SMOKE_ALLOWED_ORIGIN &&
      !url.username &&
      !url.password,
  );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const fixture = local && process.env.STAGING_SMOKE_FIXTURE === "true";
  check(url.protocol === "https:" || (fixture && url.protocol === "http:"));
  const canonical = fixture
    ? new URL(config.canonicalOrigin).origin
    : url.origin;
  check(new URL(canonical).protocol === "https:");
  check(Array.isArray(config.accounts) && config.accounts.length === 3);
  const accounts = Object.fromEntries(config.accounts.map((a) => [a.kind, a]));
  for (const kind of ["creator", "member", "moderator"]) {
    check(
      accounts[kind]?.email?.endsWith("@example.test") &&
        typeof accounts[kind].password === "string",
    );
  }
  check(new Set(config.accounts.map((a) => a.email)).size === 3);
  const basic =
    "Basic " +
    Buffer.from(config.basicUsername + ":" + config.basicPassword).toString(
      "base64",
    );
  const edge =
    config.accessClientId && config.accessClientSecret
      ? {
          "CF-Access-Client-Id": config.accessClientId,
          "CF-Access-Client-Secret": config.accessClientSecret,
        }
      : {};
  const trusted = fixture
    ? { "X-Forwarded-Proto": "https", "X-Mimi-Client-IP": "127.0.0.1" }
    : {};
  // Loopback CI simulates the HTTPS ingress; live smoke uses actual browser HTTPS.
  const headers = {
    ...edge,
    ...trusted,
    Authorization: basic,
  };
  if (process.env.GITHUB_ACTIONS === "true")
    for (const secret of [
      config.basicPassword,
      config.accessClientSecret,
      ...config.accounts.map((a) => a.password),
    ].filter(Boolean)) {
      check(!/[\r\n]/.test(secret));
      console.log("::add-mask::" + secret.replaceAll("%", "%25"));
    }
  step = "public access denial";
  const publicRequest = await request.newContext({
    baseURL: url.origin,
    extraHTTPHeaders: trusted,
  });
  try {
    for (const path of [
      "/",
      "/sign-in",
      "/api/user",
      "/api/health",
      "/icon.svg",
      "/_next/static/unknown.js",
      "/api/media/" + randomUUID(),
      "/missing-smoke-page",
    ]) {
      const r = await publicRequest.get(path, { maxRedirects: 0 });
      check([301, 302, 303, 307, 308, 401, 403].includes(r.status()));
      if (r.status() < 400) {
        const destination = new URL(r.headers().location, url.origin);
        check(destination.hostname !== url.hostname);
      }
    }
  } finally {
    await publicRequest.dispose();
  }
  // This verifies the Basic gate independently behind the optional edge service identity.
  const edgeRequest = await request.newContext({
    baseURL: url.origin,
    extraHTTPHeaders: { ...edge, ...trusted },
  });
  try {
    check(
      (await edgeRequest.get("/api/health", { maxRedirects: 0 })).status() ===
        401,
    );
  } finally {
    await edgeRequest.dispose();
  }
  console.log("PASS: public denial and independent application access gate");
  step = "browser startup";
  browser = await chromium.launch({
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    headless: true,
    args:
      process.env.GITHUB_ACTIONS === "true" || fixture ? ["--no-sandbox"] : [],
  });
  const errors = [];
  async function pageFor() {
    const context = await browser.newContext({
      extraHTTPHeaders: headers,
      viewport: { width: 1440, height: 1000 },
    });
    // Keep gate/service credentials away from off-origin redirects and media.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === url.origin
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", () => errors.push("browser error"));
    return page;
  }
  const creator = await pageFor(),
    member = await pageFor(),
    moderator = await pageFor(),
    visitor = await pageFor();
  async function visit(page, path, status = 200) {
    const r = await page.goto(url.origin + path, { waitUntil: "networkidle" });
    check(r.status() === status);
    check(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
    );
    return r;
  }
  async function audit(page) {
    await page.addScriptTag({ path: axePath });
    const ids = await page.evaluate(async () =>
      (
        await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => v.id),
    );
    check(ids.length === 0);
    scans++;
  }
  async function api(page, path, body, method = "POST", expected = 200) {
    const r = await page.request.fetch(url.origin + path, {
      method,
      headers: {
        Origin: canonical,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { data: body } : {}),
      maxRedirects: 0,
    });
    if (r.status() !== expected) {
      step += ` (HTTP ${r.status()}, expected ${expected})`;
      throw new Error("status");
    }
    return r.json();
  }
  async function login(page, account) {
    await visit(page, "/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(url.origin + "/dashboard");
  }
  step = "website and closed registration";
  const home = await visit(visitor, "/");
  check(/noindex/.test(home.headers()["x-robots-tag"]));
  check(/no-store/.test(home.headers()["cache-control"]));
  check(
    (
      await visitor.request.get(url.origin + "/api/health", { maxRedirects: 0 })
    ).ok(),
  );
  await visit(visitor, "/sign-up");
  check((await visitor.getByText(/Registration is unavailable/i).count()) > 0);
  await audit(visitor);
  step = "three real account logins";
  await login(creator, accounts.creator);
  await login(member, accounts.member);
  await login(moderator, accounts.moderator);
  const me = await api(creator, "/api/user", null, "GET");
  check(
    me.id > 0 &&
      !JSON.stringify(me).match(
        /passwordHash|password_hash|sessionVersion|session_version/,
      ),
  );
  await visit(member, "/admin/moderation", 403);
  check(
    (
      await member.request.get(url.origin + "/api/admin/health", {
        maxRedirects: 0,
      })
    ).status() === 403,
  );
  console.log(
    "PASS: availability, closed signup, real logins and staff/private account boundaries",
  );
  step = "creator setup and editing";
  await visit(creator, "/dashboard/creator-space");
  const previous = (await api(creator, "/api/creator-profile", null, "GET"))
    .profile;
  const tag = randomBytes(5).toString("hex"),
    username = previous?.username || "stage_" + tag;
  const profile = {
    username,
    displayName: "Synthetic Staging Artist",
    biography:
      "Synthetic staging profile: a kind, non-explicit creative community.",
    categories: ["Art & illustration"],
    visibility: "listed",
    theme: "lavender",
    avatar: "bow",
    banner: "daydream",
    communityAccepted: true,
  };
  await api(
    creator,
    "/api/creator-profile",
    profile,
    previous ? "PATCH" : "POST",
    previous ? 200 : 201,
  );
  step = "creator profile UI save";
  await visit(creator, "/dashboard/creator-space");
  await creator
    .getByLabel("Biography", { exact: true })
    .fill(profile.biography + " Verified " + tag + ".");
  const saving = creator.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/creator-profile" &&
      r.request().method() === "PATCH",
  );
  await creator
    .getByRole("button", { name: "Save creator profile", exact: true })
    .click();
  check((await saving).status() === 200);
  await creator
    .getByText(
      "Discovery request pending. A moderator will review your saved profile before it appears in Discover.",
      { exact: true },
    )
    .waitFor();
  await audit(creator);
  step = "creator profile approval queue";
  const own = (await api(creator, "/api/creator-profile", null, "GET")).profile;
  check(own.biography === profile.biography + " Verified " + tag + ".");
  const queue = await api(
    moderator,
    "/api/admin/moderation?q=" + username,
    null,
    "GET",
  );
  const review = queue.items.find((p) => p.username === username);
  check(
    review &&
      review.username === own.username &&
      Number.isSafeInteger(review.id),
  );
  const detail = await api(
    moderator,
    "/api/admin/moderation?kind=profile&id=" + review.id,
    null,
    "GET",
  );
  check(detail.profile.biography === own.biography);
  await api(moderator, "/api/admin/moderation", {
    action: "approve",
    profileId: review.id,
    revision: detail.profile.revision,
    reason: "Reviewed synthetic staging creator profile.",
  });
  await visit(visitor, "/creators/" + username);
  check(!(await visitor.content()).includes(accounts.creator.email));
  const other = (await api(member, "/api/creator-profile", null, "GET"))
    .profile;
  check(other === null || other.username !== username);
  await api(
    member,
    "/api/creator-profile",
    { ...profile, userId: me.id },
    "PATCH",
    400,
  );
  console.log(
    "PASS: profile edit, owner boundary, moderator approval and private public projection",
  );
  step = "text post and moderation";
  const post = await api(creator, "/api/social", {
    action: "create_post",
    title: "Synthetic staging check " + tag,
    body: "A little paper-star afternoon. Synthetic staging content only.",
  });
  await api(
    member,
    "/api/social",
    {
      action: "edit_post",
      id: post.id,
      revision: post.revision,
      title: "Denied edit",
      body: "This must not change the creator's draft.",
    },
    "POST",
    404,
  );
  check(
    (
      await visitor.request.get(
        url.origin + "/api/social?view=post&id=" + post.id,
        { maxRedirects: 0 },
      )
    ).status() === 404,
  );
  await api(creator, "/api/social", {
    action: "submit_post",
    id: post.id,
    revision: post.revision,
  });
  const pending = (
    await api(moderator, "/api/admin/social", null, "GET")
  ).items.find((p) => p.id === post.id);
  check(
    pending &&
      pending.body ===
        "A little paper-star afternoon. Synthetic staging content only.",
  );
  post.revision = pending.revision;
  await api(moderator, "/api/admin/social", {
    action: "approve_post",
    id: post.id,
    revision: post.revision,
    reason: "Reviewed synthetic text-only staging post.",
  });
  const feedResponse = member.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/social" &&
      new URL(r.url()).searchParams.get("view") === "feed",
  );
  await visit(member, "/creators/" + username);
  step = "published creator browser feed response";
  const browserFeed = await feedResponse;
  if (browserFeed.status() !== 200) {
    step += " (HTTP " + browserFeed.status() + ")";
    throw new Error("feed");
  }
  const browserItems = await browserFeed.json();
  check(browserItems.items.some((p) => p.id === post.id));
  step = "published creator browser card";
  await member.locator("#real-post-" + post.id).waitFor();
  await audit(member);
  step = "social interactions";
  for (const data of [
    { action: "follow", username, following: true },
    { action: "like", postId: post.id, liked: true },
    { action: "save", postId: post.id, saved: true },
    {
      action: "comment",
      postId: post.id,
      body: "A thoughtful synthetic staging comment.",
    },
  ])
    await api(member, "/api/social", data);
  await visit(member, "/following");
  await member.locator("#real-post-" + post.id).waitFor();
  await visit(member, "/dashboard/saved");
  await member.locator("#real-post-" + post.id).waitFor();
  await audit(member);
  const saved = await api(creator, "/api/social?scope=saved", null, "GET");
  check(!saved.items.some((p) => p.id === post.id));
  const comments = await api(
    visitor,
    "/api/social?view=comments&id=" + post.id,
    null,
    "GET",
  );
  check(
    comments.items.some(
      (c) => c.body === "A thoughtful synthetic staging comment.",
    ),
  );
  console.log(
    "PASS: moderated real text post, unauthorized edit denial, follows, likes, comments and isolated saves",
  );
  step = "reports and blocking";
  await api(member, "/api/social", {
    action: "report",
    target: "post",
    id: post.id,
    reason: "Spam",
    explanation: "Synthetic staging smoke report for operator verification.",
  });
  const activity = await api(member, "/api/social?view=activity", null, "GET");
  check(
    JSON.stringify(activity).includes(
      "Synthetic staging smoke report for operator verification.",
    ),
  );
  await api(member, "/api/safety", { action: "block", username }, "POST", 201);
  await visit(member, "/creators/" + username, 404);
  await visit(visitor, "/creators/" + username);
  await visit(member, "/dashboard/safety");
  await member
    .getByRole("button", { name: "Unblock @" + username, exact: true })
    .click();
  await member.getByText("Account unblocked.", { exact: true }).waitFor();
  await audit(member);
  console.log(
    "PASS: real report persistence, blocking and safe inaccessible profile",
  );
  step = "disabled payments and uploads";
  await api(
    creator,
    "/api/media",
    {
      action: "reserve",
      postId: post.id,
      revision: post.revision,
      description: "Synthetic disabled upload",
    },
    "POST",
    503,
  );
  await api(
    creator,
    "/api/videos",
    {
      action: "reserve",
      postId: post.id,
      revision: post.revision,
      description: "Synthetic disabled video",
      bytes: 100,
    },
    "POST",
    503,
  );
  for (const [path, method] of [
    ["/api/stripe/checkout", "GET"],
    ["/api/stripe/webhook", "POST"],
  ]) {
    const r = await creator.request.fetch(url.origin + path, {
      method,
      maxRedirects: 0,
      headers: { Origin: canonical },
    });
    check(r.status() === 503);
  }
  await visit(visitor, "/pricing");
  check(
    (await visitor
      .getByText("Payments are unavailable", { exact: false })
      .count()) > 0,
  );
  step = "mobile accessibility and logout";
  await member.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/",
    "/discover",
    "/following",
    "/dashboard/saved",
    "/dashboard/safety",
    "/creators/" + username,
  ]) {
    await visit(member, path);
    await audit(member);
  }
  await visit(visitor, "/creators/unknown_stage_" + tag, 404);
  await audit(visitor);
  await visit(member, "/dashboard");
  await member
    .getByRole("button", { name: "Open account menu", exact: true })
    .click();
  await member.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await member.waitForURL(url.origin + "/");
  check(
    (await (
      await member.request.get(url.origin + "/api/user", { maxRedirects: 0 })
    ).json()) === null,
  );
  check(
    (
      await member.request.get(url.origin + "/api/social?scope=saved", {
        maxRedirects: 0,
      })
    ).status() === 401,
  );
  check(errors.length === 0);
  console.log(
    `PASS: uploads/payments disabled, mobile routes, logout revocation; ${scans} clean axe states, no browser errors`,
  );
  console.log(
    "Smoke completed. Synthetic profile/post/report/audit records are retained; no database reset, hard deletion or account removal was performed.",
  );
})()
  .catch((error) => {
    const lines = [
      ...String(error?.stack || "").matchAll(/staging-smoke\.cjs:(\d+):\d+/g),
    ]
      .slice(0, 3)
      .map((m) => m[1])
      .join(",");
    console.error(
      "Staging smoke failed at: " +
        step +
        ". Script lines: " +
        lines +
        ". Credentials and response details withheld.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
