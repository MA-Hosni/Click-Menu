import path from "node:path";

export function createPlaywrightInvocation(workspace) {
  const workingDirectory = path.resolve(workspace);
  return {
    cwd: workingDirectory,
    args: ["test", `--config=${path.join(workingDirectory, "tests", "browser", "playwright.config.mjs")}`],
  };
}
