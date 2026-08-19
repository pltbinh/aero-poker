import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("vitest workspace", () => {
  it("routes the protocol project through a package-local config", async () => {
    const workspace = await readFile("vitest.workspace.ts", "utf8");

    expect(workspace).toContain("packages/protocol/vitest.config.mjs");
    expect(workspace).toContain("defineWorkspace");
  });
});
