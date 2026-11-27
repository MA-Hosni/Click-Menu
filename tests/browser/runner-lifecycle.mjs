/** Create an idempotent, ordered cleanup operation for runner-owned children and files. */
export function createRunnerCleanup({ children, stopChild, removeOwnedFiles }) {
  let cleanupPromise;
  return () => cleanupPromise ??= (async () => {
    const errors = [];
    for (const child of [...children].reverse()) {
      try { await stopChild(child); } catch (error) { errors.push(error); }
    }
    try { await removeOwnedFiles(); } catch (error) { errors.push(error); }
    return errors;
  })();
}

export function installRunnerSignalHandlers(cleanup, onSignal) {
  let handling = false;
  const handler = (signal) => {
    if (handling) return;
    handling = true;
    const cleanupImmediately = onSignal(signal);
    if (cleanupImmediately !== false) void cleanup();
  };
  const onInterrupt = () => handler("SIGINT");
  const onTerminate = () => handler("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  return () => {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  };
}
