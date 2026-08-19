import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

function readBasePath(): string {
  const basePath = process.env.VITE_BASE_PATH?.trim() ?? "/";

  if (basePath === "/") {
    return "/";
  }

  if (!basePath.startsWith("/") || !basePath.endsWith("/")) {
    throw new Error(
      `VITE_BASE_PATH must be "/" or a non-root path that starts and ends with "/". Received: "${basePath}"`,
    );
  }

  return basePath;
}

export default defineConfig({
  base: readBasePath(),
  plugins: [react(), tailwindcss()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@scrum-poker/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      enabled: false,
    },
  },
});
