import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("round 1 review regressions", () => {
  it("resolves root test runners through a repository-local Node entrypoint", async () => {
    const packageJson = await readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts.test).toContain("node scripts/run-local-bin.mjs vitest");
    expect(scripts["test:e2e"]).toContain("node scripts/run-local-bin.mjs playwright");

    for (const binary of ["vitest", "playwright"]) {
      const result = spawnSync(process.execPath, ["scripts/run-local-bin.mjs", "--check", binary], {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
    }
  });

  it("loads the workspace Vite dependency without the missing misc module", () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('vite');"],
      {
        cwd: `${ROOT}/apps/web`,
        encoding: "utf8",
        windowsHide: true,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
