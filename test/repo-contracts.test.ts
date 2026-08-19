import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("repo entry points", () => {
  it("wires lint:no-sockets to a real guard", async () => {
    const pkg = await readJson("package.json");
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts["lint:no-sockets"]).not.toBe('node -e "process.exit(0)"');
    expect(scripts["lint:no-sockets"]).toContain("scripts/no-sockets.mjs");
  });

  it("does not leave test:e2e as a false-green placeholder", async () => {
    const pkg = await readJson("package.json");
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts["test:e2e"]).not.toBe('node -e "process.exit(0)"');
    expect(scripts["test:e2e"]).toMatch(/not-implemented|playwright|vitest|start-server-and-test/i);
  });

  it("does not leave test:load as a false-green placeholder", async () => {
    const pkg = await readJson("package.json");
    const scripts = pkg.scripts as Record<string, string>;

    expect(scripts["test:load"]).not.toBe('node -e "process.exit(0)"');
    expect(scripts["test:load"]).toMatch(/not-implemented|load/i);
  });

  it("exposes a usable workspace configuration for protocol", async () => {
    const workspace = await readFile("vitest.workspace.ts", "utf8");

    expect(workspace).toContain("defineWorkspace");
    expect(workspace).toContain("packages/protocol");
    expect(workspace).not.toContain("export default []");
  });
});
