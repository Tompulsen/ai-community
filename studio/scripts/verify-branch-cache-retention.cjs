// Run with: node --expose-gc scripts/verify-branch-cache-retention.cjs
const assert = require("node:assert/strict");
require("tsx/cjs");
const { answerBranches, branchBusy } = require("../app/utils/chat-branches.ts");

assert.equal(typeof global.gc, "function", "Run Node with --expose-gc");

const retainedSession = {
  messages: [
    { id: "question", role: "user" },
    { id: "answer", role: "assistant", parentId: "question" },
  ],
};

function seedCache() {
  const deletedSession = {
    id: "deleted-session",
    attachment: new Uint8Array(16 * 1024 * 1024),
  };
  const state = { sessions: [retainedSession, deletedSession] };
  answerBranches(retainedSession, "answer", state);
  branchBusy(retainedSession, state);
  return {
    state: new WeakRef(state),
    deletedSession: new WeakRef(deletedSession),
  };
}

async function collect() {
  // A WeakRef target stays alive until its current JavaScript job ends.
  for (let index = 0; index < 6; index++) {
    await new Promise(setImmediate);
    global.gc();
  }
}

(async () => {
  const references = seedCache();
  await collect();
  const rootStateReleased = references.state.deref() === undefined;
  const deletedSessionReleased =
    references.deletedSession.deref() === undefined;
  assert.ok(rootStateReleased, "Branch caches must not retain old root state");
  assert.ok(deletedSessionReleased, "Deleted sessions must be collectible");
  assert.equal(answerBranches(retainedSession, "answer").total, 1);
  console.log(JSON.stringify({ rootStateReleased, deletedSessionReleased }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
