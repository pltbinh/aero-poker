import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

export const FORBIDDEN_DEPENDENCIES = new Set([
  "socket.io",
  "socket.io-client",
  "ws",
]);

const FORBIDDEN_SOURCE_PATTERNS = [
  {
    label: String.raw`new\s+WebSocket\s*\(`,
    regex: /new\s+WebSocket\s*\(/,
  },
  {
    label: String.raw`/socket\.io\/`,
    regex: /\/socket\.io\//,
  },
  {
    label: String.raw`proxy_set_header\s+Upgrade`,
    regex: /proxy_set_header\s+Upgrade/i,
  },
];

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "dist",
  "node_modules",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mdx",
  ".mjs",
  ".mts",
  ".scss",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
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

function normalizeSeparators(filePath) {
  return filePath.replace(/\\/g, "/");
}

function isPlanOrSpecDoc(relativePath) {
  const normalized = normalizeSeparators(relativePath);

  return (
    normalized.startsWith("docs/superpowers/plans/")
    || normalized.startsWith("docs/superpowers/specs/")
  );
}

function isGuardFile(relativePath) {
  const normalized = normalizeSeparators(relativePath);

  return normalized === "scripts/assert-no-sockets.mjs";
}

function shouldSkipFile(relativePath) {
  return isPlanOrSpecDoc(relativePath) || isGuardFile(relativePath);
}

function fileExtension(filePath) {
  const match = /\.[^.]+$/.exec(filePath);
  return match?.[0]?.toLowerCase() ?? "";
}

function shouldScanFile(relativePath) {
  const normalized = normalizeSeparators(relativePath);

  if (shouldSkipFile(relativePath)) {
    return false;
  }

  if (normalized.startsWith("deploy/nginx/")) {
    return true;
  }

  return TEXT_FILE_EXTENSIONS.has(fileExtension(relativePath));
}

export function findSourceViolations(sourceText, filePath) {
  const violations = [];

  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.regex.test(sourceText)) {
      violations.push(`${filePath}: ${pattern.label}`);
    }
  }

  return violations;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function walkWorkspace(rootDir, currentDir = rootDir, collected = []) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    const entryPath = join(currentDir, entry.name);
    const relativePath = relative(rootDir, entryPath);

    if (entry.isDirectory()) {
      if (isPlanOrSpecDoc(relativePath)) {
        continue;
      }

      await walkWorkspace(rootDir, entryPath, collected);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    collected.push({
      entryPath,
      relativePath,
    });
  }

  return collected;
}

export async function scanWorkspaceRoot(rootDir = process.cwd()) {
  const files = await walkWorkspace(rootDir);
  const violations = [];

  for (const { entryPath, relativePath } of files) {
    if (entryPath.endsWith("package.json")) {
      const manifest = await readJson(entryPath);

      try {
        scanPackageManifest(manifest);
      } catch (error) {
        if (error instanceof Error) {
          violations.push(`${relativePath}: ${error.message}`);
        } else {
          violations.push(`${relativePath}: unknown error`);
        }
      }

      continue;
    }

    if (!shouldScanFile(relativePath)) {
      continue;
    }

    const sourceText = await readFile(entryPath, "utf8");
    violations.push(...findSourceViolations(sourceText, relativePath));
  }

  return violations;
}

export async function runCli(rootDir = process.cwd()) {
  const violations = await scanWorkspaceRoot(rootDir);

  if (violations.length === 0) {
    console.log("No forbidden socket transports found.");
    return;
  }

  console.error(violations.join("\n"));
  process.exitCode = 1;
}

const isMain = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  await runCli();
}
