module.exports = {
  apps: [
    {
      name: "scrum-poker-backend",
      cwd: "/opt/scrum-poker/apps/server",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "256M",
      kill_timeout: 10000,
      env_production: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 4100,
        EGRESS_DISABLED_FILE: "/var/lib/scrum-poker/egress-disabled",
      },
    },
  ],
};
