import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomApi } from "../src/api/room-api.js";
import type { RoomCredentialStore } from "../src/auth/room-credentials.js";
import { App } from "../src/app.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(testDir, "..");
const repoRoot = resolve(testDir, "..", "..", "..");
const distDir = resolve(webRoot, "dist");
const distIndexPath = resolve(distDir, "index.html");
const pagesBasePath = "/scrum-poker/";
const apiBaseUrl = "https://poker-api.keothom24.com";

function buildWebApp(basePath: string) {
  rmSync(distDir, { recursive: true, force: true });

  return spawnSync("corepack pnpm --filter @scrum-poker/web build", [], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_BASE_PATH: basePath,
      VITE_API_BASE_URL: apiBaseUrl,
    },
    shell: true,
    windowsHide: true,
  });
}

function readBuiltIndexHtml(): string {
  const result = buildWebApp(pagesBasePath);

  if (result.status !== 0) {
    throw new Error(
      `Expected Pages build to pass.\nstatus: ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }

  if (!existsSync(distIndexPath)) {
    throw new Error(`Expected built artifact at ${distIndexPath}`);
  }

  return readFileSync(distIndexPath, "utf8");
}

function createApi(): RoomApi {
  return {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    createStreamTicket: vi.fn(),
    vote: vi.fn(),
    reveal: vi.fn(),
    reset: vi.fn(),
  };
}

function createCredentials(): RoomCredentialStore {
  return {
    load: vi.fn(() => null),
    save: vi.fn(),
    remove: vi.fn(),
  };
}

function extractUrls(html: string, expression: RegExp): string[] {
  return [...html.matchAll(expression)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
  window.history.replaceState({}, "", "/");
});

describe("GitHub Pages build", () => {
  it("builds the web artifact under /scrum-poker/ without filesystem path leaks", () => {
    const html = readBuiltIndexHtml();
    const stylesheets = extractUrls(
      html,
      /<link[^>]*href="([^"]+\.css)"[^>]*>/g,
    );
    const scripts = extractUrls(
      html,
      /<script[^>]*type="module"[^>]*src="([^"]+\.js)"[^>]*>/g,
    );

    expect(stylesheets.length).toBeGreaterThan(0);
    expect(scripts.length).toBeGreaterThan(0);
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain(repoRoot);
    expect(html).not.toContain(repoRoot.replaceAll("\\", "/"));
    expect(html).not.toContain("file:///");
    expect(html).not.toMatch(/[A-Za-z]:\\[^"]+/);

    for (const assetUrl of [...stylesheets, ...scripts]) {
      expect(assetUrl.startsWith(pagesBasePath)).toBe(true);
      expect(
        existsSync(resolve(distDir, assetUrl.replace(pagesBasePath, ""))),
      ).toBe(true);
    }
  }, 20000);

  it("restores a shared room from a GitHub Pages hash route", async () => {
    window.location.href = "https://owner.github.io/scrum-poker/#/room/abc";

    render(
      createElement(App, {
        api: createApi(),
        credentials: createCredentials(),
      }),
    );

    expect(await screen.findByLabelText(/room code/i)).toHaveValue("abc");
  });

  it.each(["/scrum-poker", "scrum-poker/"])(
    "rejects invalid non-root VITE_BASE_PATH values like %s",
    (invalidBasePath) => {
      const result = buildWebApp(invalidBasePath);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(output).toContain("VITE_BASE_PATH");
      expect(output).toMatch(/starts and ends with "\/"/i);
    },
    20000,
  );
});
