import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunnerCleanup, installRunnerSignalHandlers } from "./runner-lifecycle.mjs";

test("runner cleanup stops only registered children once and removes owned files once", async () => {
  const calls = [];
  const children = [{ id: "server" }, { id: "playwright" }];
  const cleanup = createRunnerCleanup({
    children,
    stopChild: async (child) => calls.push(`stop:${child.id}`),
    removeOwnedFiles: async () => calls.push("remove:owned-workspace"),
  });
  await Promise.all([cleanup(), cleanup()]);
  assert.deepEqual(calls, ["stop:playwright", "stop:server", "remove:owned-workspace"]);
});

test("signal handlers run the same idempotent cleanup before reporting interruption", async () => {
  const calls = [];
  let finishSignal;
  const signalHandled = new Promise((resolve) => { finishSignal = resolve; });
  const cleanup = createRunnerCleanup({
    children: [],
    stopChild: async () => calls.push("stop"),
    removeOwnedFiles: async () => calls.push("remove"),
  });
  const removeHandlers = installRunnerSignalHandlers(cleanup, (signal) => {
    calls.push(`signal:${signal}`);
    finishSignal();
    return true;
  });
  try {
    const handler = process.listeners("SIGTERM").at(-1);
    handler("SIGTERM");
    await signalHandled;
    await cleanup();
    assert.deepEqual(calls, ["signal:SIGTERM", "remove"]);
  } finally {
    removeHandlers();
  }
});

test("cleanup still attempts owned-file removal after a child-stop failure", async () => {
  const calls = [];
  const errors = await createRunnerCleanup({
    children: [{ id: "owned-child" }],
    stopChild: async () => { calls.push("stop"); throw new Error("synthetic termination failure"); },
    removeOwnedFiles: async () => calls.push("remove"),
  })();
  assert.deepEqual(calls, ["stop", "remove"]);
  assert.equal(errors.length, 1);
});
