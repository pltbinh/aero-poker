import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [, , requestedBinary, ...args] = process.argv;

if (!requestedBinary) {
  console.error("Usage: node scripts/run-local-bin.mjs [--check] <binary> [...args]");
  process.exit(2);
}

const checkOnly = requestedBinary === "--check";
const binary = checkOnly ? args.shift() : requestedBinary;

if (!binary || !/^[a-z0-9._-]+$/i.test(binary)) {
  console.error("A simple local binary name is required.");
  process.exit(2);
}

const suffixes = process.platform === "win32" ? [".cmd", ".CMD", ""] : [""];
const candidates = suffixes.map((suffix) => resolve(process.cwd(), "node_modules", ".bin", `${binary}${suffix}`));
const executable = candidates.find((candidate) => existsSync(candidate));

if (!executable) {
  console.error(`Local executable not found for ${binary}. Checked:\n${candidates.join("\n")}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(executable);
  process.exit(0);
}

const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
