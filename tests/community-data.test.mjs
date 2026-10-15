import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creators,
  posts,
  findCreator,
  filterCreators,
  visiblePosts,
} from "../lib/demo/community.ts";
import { demoStateSchema, emptyDemoState } from "../lib/demo/state.ts";

test("demo content has unique IDs, valid creators, and public profile routes", () => {
  assert.equal(
    new Set(creators.map((creator) => creator.id)).size,
    creators.length,
  );
  assert.equal(new Set(posts.map((post) => post.id)).size, posts.length);
  for (const post of posts)
    assert.ok(creators.some((creator) => creator.id === post.creatorId));
  for (const creator of creators)
    assert.equal(findCreator(creator.username), creator);
  assert.equal(findCreator("not-a-real-creator"), undefined);
});

test("discovery combines normalized search, category filters, and blocked creators", () => {
  assert.equal(filterCreators("  YUKI  ")[0].id, "yuki");
  assert.equal(filterCreators("femboy fashion")[0].id, "yuki");
  assert.ok(
    filterCreators("", "Cosplay").every(
      (creator) => creator.category === "Cosplay",
    ),
  );
  assert.equal(filterCreators("yuki", "Cosplay").length, 0);
  assert.equal(filterCreators("yuki", "All creators", ["yuki"]).length, 0);
});

test("following, saved, media type, and blocking cannot leak unrelated posts", () => {
  assert.equal(visiblePosts({ following: [] }).length, 0);
  assert.equal(visiblePosts({ saved: [] }).length, 0);
  const saved = [posts[0].id, posts[1].id];
  assert.deepEqual(
    visiblePosts({ saved, blocked: ["yuki"] }).map((post) => post.id),
    [posts[1].id],
  );
  assert.ok(
    visiblePosts({ following: ["kai"], type: "video" }).every(
      (post) => post.creatorId === "kai" && post.type === "video",
    ),
  );
  assert.ok(visiblePosts({ creatorId: "luna" }).length > 0);
});

test("persisted demo state rejects malformed or oversized drafts", () => {
  assert.equal(demoStateSchema.safeParse(emptyDemoState).success, true);
  assert.equal(
    demoStateSchema.safeParse({ ...emptyDemoState, blocked: "everyone" })
      .success,
    false,
  );
  assert.equal(
    demoStateSchema.safeParse({
      ...emptyDemoState,
      comments: { post: [{ id: "draft", text: "x".repeat(501) }] },
    }).success,
    false,
  );
  assert.equal(
    demoStateSchema.safeParse({
      ...emptyDemoState,
      reports: Array(51).fill({ target: "post", reason: "Spam", details: "" }),
    }).success,
    false,
  );
});
