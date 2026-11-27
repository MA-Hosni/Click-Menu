import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyBrowserWorkspace } from "./copy-policy.mjs";
import { createRunnerCleanup, installRunnerSignalHandlers } from "./runner-lifecycle.mjs";
import { createPlaywrightInvocation } from "./runner-arguments.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceName = `.checkout-browser-runtime-${randomUUID()}`;
const workspace = path.join(repositoryRoot, workspaceName);
const resultsDirectory = path.join(tmpdir(), `clickmenu-playwright-results-${randomUUID()}`);
const healthToken = randomBytes(32).toString("base64url");
const expectedWorkspaceName = /^\.checkout-browser-runtime-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const inherited = process.env;
const safeEnvironment = {};
for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramFiles", "PATHEXT", "ComSpec"])
  if (inherited[key]) safeEnvironment[key] = inherited[key];
safeEnvironment.NODE_ENV = "development";
safeEnvironment.NEXT_TELEMETRY_DISABLED = "1";
safeEnvironment.CLICKMENU_CHECKOUT_BROWSER_TEST = "1";
safeEnvironment.CLICKMENU_CHECKOUT_BROWSER_HEALTH_TOKEN = healthToken;

const children = new Set();
let workspaceCreated = false;
let resultsCreated = false;
let exitCode = 1;
let interruptedCode;

function spawnOwned(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // Target only this runner-owned PID tree; never kill by process name.
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      const timeout = setTimeout(() => { killer.kill("SIGKILL"); resolve(); }, 3_000);
      killer.once("error", () => { clearTimeout(timeout); resolve(); });
      killer.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
    if (child.exitCode === null) child.kill("SIGKILL");
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }

  const exited = await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
    const timeout = setTimeout(() => resolve(false), 5_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(true); });
  });
  if (!exited) {
    if (process.platform === "win32") child.kill("SIGKILL");
    else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const cleanup = createRunnerCleanup({
  children,
  stopChild: stopProcess,
  removeOwnedFiles: async () => {
    if (path.dirname(workspace) !== repositoryRoot || !expectedWorkspaceName.test(path.basename(workspace)))
      throw new Error("Refusing to remove an unexpected browser-test workspace.");
    if (workspaceCreated) await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 1_000 });
    const resultsParent = path.resolve(tmpdir());
    if (path.dirname(path.resolve(resultsDirectory)) !== resultsParent || !path.basename(resultsDirectory).startsWith("clickmenu-playwright-results-"))
      throw new Error("Refusing to remove an unexpected Playwright result directory.");
    if (resultsCreated) await rm(resultsDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 1_000 });
  },
});

const removeSignalHandlers = installRunnerSignalHandlers(cleanup, (signal) => {
  interruptedCode = signal === "SIGINT" ? 130 : 143;
  return children.size > 0;
});

function failIfInterrupted() {
  if (interruptedCode !== undefined) throw new Error("Browser-test runner was interrupted.");
}

try {
  if (!expectedWorkspaceName.test(workspaceName) || path.dirname(workspace) !== repositoryRoot)
    throw new Error("Refusing an unsafe isolated-workspace path.");
  await copyBrowserWorkspace(repositoryRoot, workspace);
  workspaceCreated = true;
  failIfInterrupted();
  await mkdir(resultsDirectory);
  resultsCreated = true;
  failIfInterrupted();

  const net = await import("node:net");
  const port = await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
  const baseURL = `http://127.0.0.1:${port}`;
  safeEnvironment.PORT = String(port);
  failIfInterrupted();
  const server = spawnOwned(process.execPath, [
    path.join(repositoryRoot, "node_modules", "next", "dist", "bin", "next"),
    "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port),
  ], { cwd: workspace, env: safeEnvironment });
  failIfInterrupted();
  let serverFailure;
  server.once("error", (error) => { serverFailure = error; });
  server.once("exit", (code) => { if (code !== null && code !== 0) serverFailure = new Error(`Isolated Next.js server exited with code ${code}.`); });

  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    failIfInterrupted();
    if (serverFailure) throw serverFailure;
    try {
      const response = await fetch(`${baseURL}/browser-test/health`, {
        headers: { "x-clickmenu-browser-health": healthToken },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok && (await response.json()).ready === true) { ready = true; break; }
    } catch { /* Next.js is still compiling or starting. */ }
    failIfInterrupted();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Isolated Next.js test route did not become ready within 120 seconds.");
  failIfInterrupted();

  safeEnvironment.CLICKMENU_CHECKOUT_BROWSER_BASE_URL = baseURL;
  safeEnvironment.CLICKMENU_CHECKOUT_BROWSER_RESULTS_DIR = resultsDirectory;
  const invocation = createPlaywrightInvocation(workspace);
  const browserTests = spawnOwned(process.execPath, [
    path.join(repositoryRoot, "node_modules", "@playwright", "test", "cli.js"),
    ...invocation.args,
  ], { cwd: invocation.cwd, env: safeEnvironment });
  failIfInterrupted();
  exitCode = await waitForChild(browserTests);
} catch (error) {
  process.stderr.write(`Isolated checkout browser tests failed to start safely: ${error instanceof Error ? error.message : "unknown error"}\n`);
  exitCode = 1;
} finally {
  removeSignalHandlers();
  const cleanupErrors = await cleanup();
  if (cleanupErrors.length > 0)
    process.stderr.write(`Browser-test cleanup had ${cleanupErrors.length} error(s); Windows process-tree termination is best effort.\n`);
}
process.exitCode = interruptedCode ?? exitCode;
