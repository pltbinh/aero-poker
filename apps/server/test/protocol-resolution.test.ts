import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server protocol resolution", () => {
  it("uses committed protocol source paths for vitest and typecheck", async () => {
    const vitestConfig = await readFile(new URL("../vitest.config.mjs", import.meta.url), "utf8");
    const tsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");

    expect(vitestConfig).toContain("../../packages/protocol/src/index.ts");
    expect(vitestConfig).not.toContain("/dist/");
    expect(tsconfig).toContain("packages/protocol/src/index.ts");
    expect(tsconfig).not.toContain("/dist/");
  });
});
