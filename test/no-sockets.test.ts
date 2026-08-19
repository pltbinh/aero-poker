import { describe, expect, it } from "vitest";
import { collectSocketViolations, scanPackageManifest } from "../scripts/no-sockets.mjs";

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
});
