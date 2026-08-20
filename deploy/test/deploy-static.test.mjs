import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const assetPaths = {
  envExample: "apps/server/.env.example",
  ecosystem: "deploy/ecosystem.config.cjs",
  bootstrapNginx: "deploy/nginx/scrum-poker-http.conf",
  productionNginx: "deploy/nginx/scrum-poker.conf",
  deployScript: "deploy/deploy.sh",
};

function readAsset(relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  expect(
    existsSync(absolutePath),
    `required asset is missing: ${relativePath}`,
  ).toBe(true);
  return readFileSync(absolutePath, "utf8");
}

describe("isolated Scrum Poker deployment assets", () => {
  it("contains every required deployment asset", () => {
    for (const relativePath of Object.values(assetPaths)) {
      expect(
        existsSync(resolve(repositoryRoot, relativePath)),
        `missing ${relativePath}`,
      ).toBe(true);
    }
    expect(
      existsSync(resolve(repositoryRoot, "deploy/test/deploy-static.test.mjs")),
    ).toBe(true);
  });

  it("documents production settings without secrets", () => {
    const envExample = readAsset(assetPaths.envExample);

    expect(envExample).toContain("NODE_ENV=production");
    expect(envExample).toContain("HOST=127.0.0.1");
    expect(envExample).toContain("PORT=4100");
    expect(envExample).toContain(
      "CORS_ORIGINS=https://<github-owner>.github.io",
    );
    expect(envExample).toContain(
      "EGRESS_DISABLED_FILE=/var/lib/scrum-poker/egress-disabled",
    );
    expect(envExample).not.toMatch(
      /(?:password|secret|token|api[_-]?key)\s*=/i,
    );
    expect(envExample).not.toMatch(/(?:sk|ghp|xox[baprs])-[_a-z0-9-]{12,}/i);
  });

  it("defines only the isolated PM2 production process", () => {
    const ecosystem = readAsset(assetPaths.ecosystem);

    expect(ecosystem).toContain('name: "scrum-poker-backend"');
    expect(ecosystem).toContain('cwd: "/opt/scrum-poker/apps/server"');
    expect(ecosystem).toContain('script: "dist/index.js"');
    expect(ecosystem).toContain("instances: 1");
    expect(ecosystem).toContain('exec_mode: "fork"');
    expect(ecosystem).toContain('max_memory_restart: "256M"');
    expect(ecosystem).toContain('NODE_ENV: "production"');
    expect(ecosystem).toContain('HOST: "127.0.0.1"');
    expect(ecosystem).toContain("PORT: 4100");
    expect(ecosystem).toContain(
      'EGRESS_DISABLED_FILE: "/var/lib/scrum-poker/egress-disabled"',
    );
    expect(ecosystem).not.toMatch(/keothom|socket\.io|websocket|upgrade/i);
  });

  it("defines a certificate bootstrap site without proxying application traffic", () => {
    const bootstrapNginx = readAsset(assetPaths.bootstrapNginx);

    expect(bootstrapNginx).toContain("server_name poker-api.keothom24.com;");
    expect(bootstrapNginx).toContain(
      "location ^~ /.well-known/acme-challenge/",
    );
    expect(bootstrapNginx).toContain("root /var/www/letsencrypt;");
    expect(bootstrapNginx).toContain("try_files $uri =404;");
    expect(bootstrapNginx).not.toMatch(
      /proxy_pass|Upgrade|socket\.io|websocket/i,
    );
  });

  it("preserves SSE behavior and returns a JSON maintenance response", () => {
    const productionNginx = readAsset(assetPaths.productionNginx);

    expect(productionNginx).toContain("upstream scrum_poker_backend");
    expect(productionNginx).toContain("server 127.0.0.1:4100;");
    expect(productionNginx).toContain("listen 443 ssl http2;");
    expect(productionNginx).toContain("server_name poker-api.keothom24.com;");
    expect(productionNginx).toContain(
      "ssl_certificate /etc/letsencrypt/live/poker-api.keothom24.com/fullchain.pem;",
    );
    expect(productionNginx).toContain(
      "ssl_certificate_key /etc/letsencrypt/live/poker-api.keothom24.com/privkey.pem;",
    );
    expect(productionNginx).toContain("location ~ ^/api/rooms/[^/]+/stream$");
    expect(productionNginx).toContain("proxy_http_version 1.1;");
    expect(productionNginx).toContain('proxy_set_header Connection "";');
    expect(productionNginx).toContain("proxy_buffering off;");
    expect(productionNginx).toContain("proxy_cache off;");
    expect(productionNginx).toContain("gzip off;");
    expect(productionNginx).toContain("proxy_read_timeout 75s;");
    expect(productionNginx).toContain("/var/lib/scrum-poker/egress-disabled");
    expect(productionNginx).toContain(
      'return 503 \'{"code":"SERVICE_UNAVAILABLE","message":"Scrum Poker is temporarily unavailable."}\';',
    );
    expect(productionNginx).not.toMatch(
      /\b(?:Upgrade|upgrade)\b|socket\.io|websocket/i,
    );
  });

  it("guards the deployment script against cross-service and broad mutations", () => {
    const script = readAsset(assetPaths.deployScript);

    expect(script).toMatch(/^set -Eeuo pipefail$/m);
    expect(script).toContain('readonly APP_DIR="/opt/scrum-poker"');
    expect(script).toContain('readonly APP_NAME="scrum-poker-backend"');
    expect(script).toContain('readonly BACKEND_PORT="4100"');
    expect(script).toContain('readonly API_HOSTNAME="poker-api.keothom24.com"');
    expect(script).toContain('readonly NGINX_SITE="scrum-poker"');
    expect(script).toContain("corepack pnpm install --frozen-lockfile");
    expect(script).toContain("corepack pnpm test");
    expect(script).toContain("corepack pnpm lint:no-sockets");
    expect(script).toContain("corepack pnpm build");
    expect(script).toContain("certbot certonly");
    expect(script).toContain("--webroot");
    expect(script).toContain('-d "${API_HOSTNAME}"');
    expect(script).toContain("pm2 save");
    expect(script).toContain('pm2 restart "$APP_NAME" --update-env');
    expect(script).toContain(
      'pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" --only "$APP_NAME" --env production',
    );
    expect(script).not.toMatch(
      /pm2\s+(?:restart|stop|delete)\s+[^\n]*keothom-/i,
    );
    expect(script).not.toMatch(/sites-(?:available|enabled)[/\\]keothom/i);
    expect(script).not.toMatch(/\/opt\/keothom|\/var\/lib\/keothom/i);
    expect(script).not.toMatch(
      /\brm\s+-rf\b|pm2\s+(?:stop|delete)\s+all\b|systemctl\s+(?:restart|stop)\s+nginx\b/i,
    );
    expect(script).not.toMatch(
      /\b(?:pm2|install|ln|certbot|systemctl)[^\n]*\$(?:\{)?[1-9]/,
    );
    expect(script).not.toMatch(/\b(?:Upgrade|upgrade)\b|socket\.io|websocket/i);
  });

  it("checks prerequisites, capacity, port ownership, and KeoThom state without installing anything", () => {
    const script = readAsset(assetPaths.deployScript);

    expect(script).toMatch(
      /for command_name in node pm2 nginx certbot corepack git vnstat jq/,
    );
    expect(script).toContain('command -v "${command_name}"');
    expect(script).toContain("Ubuntu");
    expect(script).toContain("Debian");
    expect(script).toContain("300");
    expect(script).toContain("1048576");
    expect(script).toContain("ss -ltn");
    expect(script).toContain('pm2 describe "$APP_NAME"');
    expect(script).toContain("pm2 jlist");
    expect(script).toContain("keothom-backend");
    expect(script).toContain("keothom-frontend");
    expect(script).not.toMatch(
      /apt(?:-get)?\s+(?:install|upgrade|update)|npm\s+install\s+-g|curl[^\n]*\|\s*(?:sh|bash)/i,
    );
  });

  it("validates Nginx before every reload", () => {
    const script = readAsset(assetPaths.deployScript);
    const validationIndex = script.indexOf("nginx -t");
    const reloadIndex = script.indexOf("systemctl reload nginx");

    expect(validationIndex).toBeGreaterThanOrEqual(0);
    expect(reloadIndex).toBeGreaterThan(validationIndex);
  });
});
