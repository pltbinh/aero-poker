const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
const AxeBuilder = require("@axe-core/playwright").default;
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
  const tempDir = await mkdtemp(join(tmpdir(), "scrum-poker-accessibility-"));
  const apiUrl = `http://${HOST}:${apiPort}`;
  const webUrl = `http://${HOST}:${webPort}`;

  await runCommand(PNPM_COMMAND, ["pnpm", "--filter", "@scrum-poker/server", "build"], {});
  await runCommand(
    VITE_COMMAND,
    ["build", "--config", "apps/web/vite.config.ts"],
    {
      VITE_API_BASE_URL: apiUrl,
      VITE_BASE_PATH: "/",
    },
  );

  const serverProcess = spawn(NODE_COMMAND, ["apps/server/dist/index.js"], {
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

  await waitForHttp(`${apiUrl}/health/ready`);
  await waitForHttp(webUrl);

  return {
    webUrl,
    dispose: async () => {
      await Promise.allSettled([
        stopProcess(previewProcess),
        stopProcess(serverProcess),
      ]);
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function expectNoSeriousViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const reportable = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");

  expect(reportable, JSON.stringify(reportable, null, 2)).toEqual([]);
}

async function expectNoHorizontalOverflow(page) {
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    )
    .toBe(true);
}

function deckCard(page, value) {
  return page.getByRole("button", { name: String(value), exact: true });
}

test.describe.configure({ mode: "serial" });

let environment;

test.beforeAll(async () => {
  environment = await createEnvironment();
});

test.afterAll(async () => {
  if (environment !== undefined) {
    await environment.dispose();
  }
});

test("landing, voting, and revealed views stay accessible on a narrow viewport", async ({ browser }) => {
  test.slow();

  const creator = await browser.newContext({
    viewport: {
      width: 390,
      height: 844,
    },
  });
  const participant = await browser.newContext({
    viewport: {
      width: 390,
      height: 844,
    },
  });
  const creatorPage = await creator.newPage();
  const participantPage = await participant.newPage();

  await creatorPage.goto(environment.webUrl);
  await expect(creatorPage.getByRole("heading", { name: /estimate together/i })).toBeVisible();
  await expectNoHorizontalOverflow(creatorPage);
  await expectNoSeriousViolations(creatorPage);

  await creatorPage.getByLabel(/display name/i).fill("Alex");
  await creatorPage.getByRole("button", { name: /create room/i }).focus();
  await creatorPage.keyboard.press("Enter");
  await expect(creatorPage).toHaveURL(/#\/room\//);
  await expectNoHorizontalOverflow(creatorPage);
  await expectNoSeriousViolations(creatorPage);

  const roomUrl = creatorPage.url();
  await participantPage.goto(roomUrl);
  await participantPage.getByLabel(/display name/i).fill("Sam");
  await participantPage.getByRole("button", { name: /join room/i }).click();

  const creatorFive = deckCard(creatorPage, 5);
  const participantEight = deckCard(participantPage, 8);
  await expect(creatorFive).toHaveCount(1);
  await expect(participantEight).toHaveCount(1);
  await creatorFive.focus();
  await creatorPage.keyboard.press("Enter");
  await expect(creatorPage.getByText(/selected card: 5/i)).toBeVisible();

  await participantEight.focus();
  await participantPage.keyboard.press("Enter");
  await expect(participantPage.getByText(/selected card: 8/i)).toBeVisible();

  await creatorPage.getByRole("button", { name: /reveal votes/i }).focus();
  await creatorPage.keyboard.press("Enter");
  await expect(creatorPage.getByRole("list", { name: /revealed vote distribution/i })).toBeVisible();
  await expectNoHorizontalOverflow(creatorPage);
  await expectNoSeriousViolations(creatorPage);

  await Promise.all([creator.close(), participant.close()]);
});
