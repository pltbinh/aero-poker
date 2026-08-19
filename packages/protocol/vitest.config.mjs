import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "protocol",
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
