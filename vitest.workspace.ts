import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      pool: "threads",
      poolOptions: {
        threads: {
          singleThread: true,
        },
      },
    },
  },
  {
    test: {
      root: "packages/protocol",
      environment: "node",
      include: ["test/**/*.test.ts"],
      pool: "threads",
      poolOptions: {
        threads: {
          singleThread: true,
        },
      },
    },
  },
]);
