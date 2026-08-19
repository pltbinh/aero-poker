const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
const { test, expect } = require("@playwright/test");

const ROOT_DIR = process.cwd();
const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 60_000;
const NODE_COMMAND = process.execPath;
const PNPM_COMMAND = "corepack";
const VITE_COMMAND = join(ROOT_DIR, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");

async function allocatePort() {
  const net = require("node:net");

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Expected an IPv4 test port.")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function runCommand(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...env,
      },
      shell: process.platform === "win32",
      stdio: "pipe",
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Command failed: ${command} ${args.join(" ")}`));
    });
  });
}

async function waitForHttp(url, predicate = (response) => response.ok) {
  const start = Date.now();

  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(url);

      if (predicate(response)) {
        return;
      }
    } catch {
      // Retry until the timeout is reached.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(processToStop) {
  if (!processToStop || processToStop.exitCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    processToStop.once("error", reject);
    processToStop.once("exit", () => resolve());
    processToStop.kill("SIGTERM");
  });
}

async function createEnvironment() {
  const apiPort = await allocatePort();
  const webPort = await allocatePort();
  const tempDir = await mkdtemp(join(tmpdir(), "scrum-poker-reconnect-"));
  const apiUrl = `http://${HOST}:${apiPort}`;
  const webUrl = `http://${HOST}:${webPort}`;
  let serverProcess = null;

  await runCommand(PNPM_COMMAND, ["pnpm", "--filter", "@scrum-poker/server", "build"], {});
  await runCommand(
    VITE_COMMAND,
    ["build", "--config", "apps/web/vite.config.ts"],
    {
      VITE_API_BASE_URL: apiUrl,
      VITE_BASE_PATH: "/",
    },
  );

  const previewProcess = spawn(
    VITE_COMMAND,
    ["preview", "--config", "apps/web/vite.config.ts", "--host", HOST, "--port", String(webPort), "--strictPort"],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
      },
      shell: process.platform === "win32",
      stdio: "pipe",
    },
  );

  await waitForHttp(webUrl);

  return {
    webUrl,
    startApi: async () => {
      serverProcess = spawn(NODE_COMMAND, ["apps/server/dist/index.js"], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          NODE_ENV: "test",
          HOST,
          PORT: String(apiPort),
          CORS_ORIGINS: webUrl,
          EGRESS_DISABLED_FILE: join(tempDir, "egress-disabled.flag"),
        },
        stdio: "pipe",
      });
      await waitForHttp(`${apiUrl}/health/ready`);
    },
    stopApi: async () => {
      await stopProcess(serverProcess);
      serverProcess = null;
    },
    dispose: async () => {
      await Promise.allSettled([
        stopProcess(previewProcess),
        stopProcess(serverProcess),
      ]);
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

test.describe.configure({ mode: "serial" });

let environment;

test.beforeAll(async () => {
  environment = await createEnvironment();
  await environment.startApi();
});

test.afterAll(async () => {
  if (environment !== undefined) {
    await environment.dispose();
  }
});

test("shows recovery messaging when the browser goes offline and reconnects on demand", async ({ browser }) => {
  test.slow();

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;

    class TrackedEventSource extends NativeEventSource {
      constructor(url, eventSourceInitDict) {
        super(url, eventSourceInitDict);
        window.__scrumPokerEventSource = this;
      }
    }

    window.EventSource = TrackedEventSource;
  });

  await page.goto(environment.webUrl);
  await page.getByLabel(/display name/i).fill("Alex");
  await page.getByRole("button", { name: /create room/i }).click();
  await expect(page.getByText(/live connection active/i)).toBeVisible();

  const roomUrl = page.url();
  await context.setOffline(true);
  await page.evaluate(() => {
    window.__scrumPokerEventSource?.dispatchEvent(new Event("error"));
  });
  await expect(page.getByText(/offline\. live updates are paused until you reconnect\./i)).toBeVisible();
  await expect(page.getByRole("button", { name: /reconnect/i })).toBeVisible();

  const participantContext = await browser.newContext();
  const participantPage = await participantContext.newPage();
  await participantPage.goto(roomUrl);
  await participantPage.getByLabel(/display name/i).fill("Sam");
  await participantPage.getByRole("button", { name: /join room/i }).click();
  await participantPage.getByRole("button", { name: "8", exact: true }).click();
  await expect(participantPage.getByText(/selected card: 8/i)).toBeVisible();
  await participantContext.close();

  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  const reconnectTicket = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/stream-ticket$/.test(response.url()),
  );
  await page.getByRole("button", { name: /reconnect/i }).click();
  await expect((await reconnectTicket).status()).toBe(201);
  await expect(page.getByText(/live connection active/i)).toBeVisible();

  await context.close();
});

test("expires the room after a local test-server restart removes in-memory state", async ({ browser }) => {
  test.slow();

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(environment.webUrl);
  await page.getByLabel(/display name/i).fill("Alex");
  await page.getByRole("button", { name: /create room/i }).click();
  await expect(page.getByText(/live connection active/i)).toBeVisible();

  await environment.stopApi();
  await expect(page.getByText(/offline\. live updates are paused until you reconnect\./i)).toBeVisible();

  await environment.startApi();
  await page.getByRole("button", { name: /reconnect/i }).click();
  await expect(page.getByRole("heading", { name: /room expired/i })).toBeVisible();

  await context.close();
});
