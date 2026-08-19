import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN_DEPENDENCIES = new Set([
  "socket.io",
  "socket.io-client",
  "ws",
]);

function dependencySections(manifest) {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].filter(Boolean);
}

export function collectSocketViolations(manifest) {
  const violations = new Set();

  for (const section of dependencySections(manifest)) {
    for (const name of Object.keys(section)) {
      if (FORBIDDEN_DEPENDENCIES.has(name)) {
        violations.add(name);
      }
    }
  }

  return [...violations];
}

export function scanPackageManifest(manifest) {
  const violations = collectSocketViolations(manifest);
  if (violations.length > 0) {
    throw new Error(`Forbidden socket transports found: ${violations.join(", ")}`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function walkPackageJsonFiles(rootDir, collected = []) {
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }

    const entryPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkPackageJsonFiles(entryPath, collected);
      continue;
    }

    if (entry.isFile() && entry.name === "package.json") {
      collected.push(entryPath);
    }
  }

  return collected;
}

export async function scanWorkspaceRoot(rootDir = process.cwd()) {
  const files = await walkPackageJsonFiles(rootDir);
  const violations = [];

  for (const filePath of files) {
    const manifest = await readJson(filePath);
    try {
      scanPackageManifest(manifest);
    } catch (error) {
      if (error instanceof Error) {
        violations.push(`${filePath}: ${error.message}`);
      } else {
        violations.push(`${filePath}: unknown error`);
      }
    }
  }

  return violations;
}

const violations = await scanWorkspaceRoot();
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
}
