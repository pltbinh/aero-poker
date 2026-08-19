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
  const tempDir = await mkdtemp(join(tmpdir(), "scrum-poker-room-flow-"));
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
    apiUrl,
    previewProcess,
    serverProcess,
    tempDir,
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

function attachNetworkCapture(page) {
  const requests = [];
  const websockets = [];

  page.on("request", (request) => {
    requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  page.on("websocket", (websocket) => {
    websockets.push(websocket.url());
  });

  return { requests, websockets };
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

test("creator and participants complete a private round over HTTP and EventSource only", async ({ browser }) => {
  test.slow();

  const creator = await browser.newContext();
  const participant = await browser.newContext();
  const observer = await browser.newContext();
  const creatorPage = await creator.newPage();
  const participantPage = await participant.newPage();
  const observerPage = await observer.newPage();

  const creatorNetwork = attachNetworkCapture(creatorPage);
  const participantNetwork = attachNetworkCapture(participantPage);

  await creatorPage.goto(environment.webUrl);
  await creatorPage.getByLabel(/display name/i).fill("Alex");
  await creatorPage.getByRole("button", { name: /create room/i }).click();

  await expect(creatorPage).toHaveURL(/#\/room\//);

  const roomUrl = creatorPage.url();
  const roomId = roomUrl.split("/room/")[1] ?? "";

  expect(roomId).not.toEqual("");
  await expect(creatorPage.getByRole("button", { name: /reveal votes/i })).toBeVisible();

  await participantPage.goto(roomUrl);
  await expect(participantPage.getByRole("heading", { name: /estimate together/i })).toBeVisible();
  await expect(participantPage.getByLabel(/room code/i)).toHaveValue(roomId);
  await participantPage.getByLabel(/display name/i).fill("Sam");
  await participantPage.getByRole("button", { name: /join room/i }).click();
  await expect(participantPage).toHaveURL(new RegExp(`#\\/room\\/${roomId}$`));
  await expect(participantPage.getByRole("button", { name: /reveal votes/i })).toHaveCount(0);
  await expect(participantPage.getByRole("button", { name: /reset round/i })).toHaveCount(0);

  await creatorPage.reload();
  await expect(creatorPage.getByRole("button", { name: /reveal votes/i })).toBeVisible();

  await observerPage.goto(roomUrl);
  await expect(observerPage.getByRole("heading", { name: /estimate together/i })).toBeVisible();
  await observerPage.getByLabel(/display name/i).fill("Tia");
  await observerPage.getByRole("button", { name: /join room/i }).click();
  await expect(observerPage.getByRole("button", { name: /reveal votes/i })).toHaveCount(0);
  await expect(observerPage.getByRole("button", { name: /reset round/i })).toHaveCount(0);

  const creatorFive = deckCard(creatorPage, 5);
  const participantEight = deckCard(participantPage, 8);
  await expect(creatorFive).toHaveCount(1);
  await expect(participantEight).toHaveCount(1);
  await creatorFive.click();
  await participantEight.click();

  const creatorParticipants = creatorPage.getByRole("list", { name: /participants/i });
  const participantRows = participantPage.getByRole("list", { name: /participants/i }).getByRole("listitem");

  await expect(creatorParticipants).toContainText("Voted");
  await expect(participantRows.nth(0)).not.toContainText(/\b5\b/);
  await expect(participantRows.nth(1)).not.toContainText(/\b8\b/);

  await creatorPage.getByRole("button", { name: /reveal votes/i }).click();

  const distribution = creatorPage.getByRole("list", { name: /revealed vote distribution/i });
  await expect(distribution).toContainText("5");
  await expect(distribution).toContainText("1 vote");
  await expect(distribution).toContainText("8");

  const revealedParticipants = participantPage.getByRole("list", { name: /participants/i });
  await expect(revealedParticipants).toContainText("5");
  await expect(revealedParticipants).toContainText("8");

  await creatorPage.getByRole("button", { name: /reset round/i }).click();

  await expect(creatorPage.getByRole("list", { name: /revealed vote distribution/i })).toHaveCount(0);
  await expect(creatorPage.getByRole("list", { name: /participants/i })).toContainText("Waiting");

  expect(participantNetwork.requests.filter((request) => /\/(reveal|reset)$/.test(request.url))).toHaveLength(0);

  const combinedRequests = [...creatorNetwork.requests, ...participantNetwork.requests];
  const combinedWebsockets = [...creatorNetwork.websockets, ...participantNetwork.websockets];

  expect(combinedRequests.some((request) => request.resourceType === "document" || request.resourceType === "fetch")).toBe(true);
  expect(
    combinedRequests.some(
      (request) => request.resourceType === "eventsource" || /\/stream\?ticket=/.test(request.url),
    ),
  ).toBe(true);
  expect(combinedRequests.some((request) => /websocket/i.test(request.url))).toBe(false);
  expect(combinedWebsockets).toEqual([]);

  await Promise.all([creator.close(), participant.close(), observer.close()]);
});
