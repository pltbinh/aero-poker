export * from "./assert-no-sockets.mjs";

import { fileURLToPath } from "node:url";
import { runCli } from "./assert-no-sockets.mjs";

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCli();
}
