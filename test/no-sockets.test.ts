import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSocketViolations, scanPackageManifest, scanWorkspaceRoot } from "../scripts/no-sockets.mjs";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

async function createWorkspaceFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scrum-poker-no-sockets-"));
  tempRoots.push(root);
  return root;
}

describe("no-socket guard", () => {
  it("flags forbidden socket transports in a manifest", () => {
    const violations = collectSocketViolations({
      dependencies: {
        react: "^19.0.0",
        "socket.io-client": "^4.7.5",
      },
    });

    expect(violations).toContain("socket.io-client");
  });

  it("accepts a clean manifest", () => {
    expect(() =>
      scanPackageManifest({
        name: "scrum-poker",
        dependencies: {
          react: "^19.0.0",
        },
        devDependencies: {
          vitest: "^3.2.7",
        },
      }),
    ).not.toThrow();
  });

  it("reports the exact file and source pattern for websocket usage", async () => {
    const root = await createWorkspaceFixture();
    await mkdir(join(root, "apps", "web", "src"), { recursive: true });
    await writeFile(
      join(root, "apps", "web", "src", "socket-client.ts"),
      [
        "export function connect() {",
        '  return new ' + 'WebSocket("wss://example.invalid");',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const violations = await scanWorkspaceRoot(root);

    expect(violations.some((violation) => violation.includes(join("apps", "web", "src", "socket-client.ts")))).toBe(true);
    expect(violations.some((violation) => violation.includes("new\\s+WebSocket\\s*\\("))).toBe(true);
  });

  it("ignores forbidden phrases inside excluded plan and spec documentation", async () => {
    const root = await createWorkspaceFixture();
    await mkdir(join(root, "docs", "superpowers", "plans"), { recursive: true });
    await mkdir(join(root, "docs", "superpowers", "specs"), { recursive: true });
    await mkdir(join(root, "apps", "web", "src"), { recursive: true });
    await writeFile(
      join(root, "docs", "superpowers", "plans", "plan.md"),
      "proxy_set_header " + "Upgrade\n",
      "utf8",
    );
    await writeFile(
      join(root, "docs", "superpowers", "specs", "spec.md"),
      "/" + "socket.io/\n",
      "utf8",
    );
    await writeFile(
      join(root, "apps", "web", "src", "safe.ts"),
      "export const safe = true;\n",
      "utf8",
    );

    await expect(scanWorkspaceRoot(root)).resolves.toEqual([]);
  });
});
