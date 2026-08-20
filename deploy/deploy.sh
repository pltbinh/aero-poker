#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly APP_DIR="/opt/scrum-poker"
readonly SERVER_DIR="${APP_DIR}/apps/server"
readonly APP_NAME="scrum-poker-backend"
readonly BACKEND_PORT="4100"
readonly API_HOSTNAME="poker-api.keothom24.com"
readonly NGINX_SITE="scrum-poker"
readonly NGINX_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE}"
readonly NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE}"
readonly CERT_ROOT="/var/www/letsencrypt"
readonly CERT_DIR="/etc/letsencrypt/live/${API_HOSTNAME}"
readonly MAINTENANCE_FLAG="/var/lib/scrum-poker/egress-disabled"
readonly ENV_FILE="${SERVER_DIR}/.env"
readonly ECOSYSTEM_FILE="${APP_DIR}/deploy/ecosystem.config.cjs"
readonly BOOTSTRAP_NGINX_FILE="${APP_DIR}/deploy/nginx/scrum-poker-http.conf"
readonly PRODUCTION_NGINX_FILE="${APP_DIR}/deploy/nginx/scrum-poker.conf"
readonly MIN_AVAILABLE_MEMORY_MIB=300
readonly MIN_AVAILABLE_DISK_KIB=1048576

die() {
  printf 'deploy: %s\n' "$*" >&2
  exit 1
}

as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

require_prerequisites() {
  local missing=()
  local command_name

  for command_name in node pm2 nginx certbot corepack git vnstat jq ss free df awk install; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      missing+=("${command_name}")
    fi
  done

  if [[ "${EUID}" -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then
    missing+=("sudo")
  fi

  if ((${#missing[@]} > 0)); then
    printf 'deploy: missing prerequisites (install them separately; this script will not install packages): %s\n' \
      "${missing[*]}" >&2
    exit 1
  fi
}

validate_platform() {
  [[ -r /etc/os-release ]] || die "Ubuntu/Debian release metadata is required."
  # shellcheck disable=SC1091
  source /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) die "Ubuntu or Debian is required; found ${ID:-unknown}." ;;
  esac

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "${node_major}" == "20" ]] || die "Node.js major version 20 is required; found ${node_major}."
}

validate_capacity() {
  local available_memory_mib available_disk_kib
  available_memory_mib="$(free -m | awk '/^Mem:/ { print $7; exit }')"
  available_disk_kib="$(df -Pk /opt | awk 'NR == 2 { print $4; exit }')"
  [[ "${available_memory_mib:-0}" =~ ^[0-9]+$ ]] || die "could not read available memory."
  [[ "${available_disk_kib:-0}" =~ ^[0-9]+$ ]] || die "could not read free disk space."
  ((available_memory_mib >= MIN_AVAILABLE_MEMORY_MIB)) || die "at least 300 MiB available memory is required."
  ((available_disk_kib >= MIN_AVAILABLE_DISK_KIB)) || die "at least 1 GiB free disk space is required."
}

validate_paths_and_environment() {
  [[ -d "${APP_DIR}" ]] || die "application root ${APP_DIR} does not exist."
  [[ -f "${APP_DIR}/pnpm-lock.yaml" ]] || die "the Scrum Poker lockfile is missing."
  [[ -f "${ECOSYSTEM_FILE}" ]] || die "the Scrum Poker PM2 configuration is missing."
  [[ -f "${BOOTSTRAP_NGINX_FILE}" ]] || die "the Scrum Poker bootstrap Nginx configuration is missing."
  [[ -f "${PRODUCTION_NGINX_FILE}" ]] || die "the Scrum Poker production Nginx configuration is missing."
  [[ -f "${ENV_FILE}" ]] || die "create ${ENV_FILE} from apps/server/.env.example before deploying."

  grep -qx 'NODE_ENV=production' "${ENV_FILE}" || die "${ENV_FILE} must set NODE_ENV=production."
  grep -Eq '^HOST=127\.0\.0\.1$' "${ENV_FILE}" || die "${ENV_FILE} must bind HOST=127.0.0.1."
  grep -Eq '^PORT=4100$' "${ENV_FILE}" || die "${ENV_FILE} must set PORT=4100."
  grep -Eq '^CORS_ORIGINS=https://[^[:space:]]+\.github\.io$' "${ENV_FILE}" || die "${ENV_FILE} must set the GitHub Pages CORS origin."
  grep -Eq '^EGRESS_DISABLED_FILE=/var/lib/scrum-poker/egress-disabled$' "${ENV_FILE}" || die "${ENV_FILE} must use the Scrum Poker maintenance flag."
}

check_backend_port() {
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    return
  fi

  if ss -ltn | awk -v expected_port=":${BACKEND_PORT}" '$4 ~ expected_port "$" { found = 1 } END { exit found ? 0 : 1 }'; then
    die "port ${BACKEND_PORT} is in use by a process other than ${APP_NAME}."
  fi
}

capture_keothom_state() {
  local pm2_state
  pm2_state="$(pm2 jlist)"
  for process_name in keothom-backend keothom-frontend; do
    jq -e --arg process_name "${process_name}" \
      '.[] | select(.name == $process_name and .pm2_env.status == "online") | .pm2_env.restart_time' \
      <<<"${pm2_state}" >/dev/null || die "${process_name} must be online before deployment."
  done
  printf '%s' "${pm2_state}"
}

assert_keothom_state_unchanged() {
  local before_state="${1}"
  local after_state process_name before_restarts after_restarts
  after_state="$(pm2 jlist)"

  for process_name in keothom-backend keothom-frontend; do
    before_restarts="$(jq -er --arg process_name "${process_name}" \
      '.[] | select(.name == $process_name) | .pm2_env.restart_time' <<<"${before_state}")"
    after_restarts="$(jq -er --arg process_name "${process_name}" \
      '.[] | select(.name == $process_name) | .pm2_env.restart_time' <<<"${after_state}")"
    [[ "${before_restarts}" == "${after_restarts}" ]] || die "${process_name} restart counter changed."
    jq -e --arg process_name "${process_name}" \
      '.[] | select(.name == $process_name and .pm2_env.status == "online")' \
      <<<"${after_state}" >/dev/null || die "${process_name} is not online after deployment."
  done
}

run_scrum_poker_checks() {
  cd "${APP_DIR}"
  corepack pnpm install --frozen-lockfile
  corepack pnpm test
  corepack pnpm lint:no-sockets
  corepack pnpm build
}

install_bootstrap_site_if_needed() {
  if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
    return
  fi

  as_root install -d -m 0755 "${CERT_ROOT}"
  as_root install -m 0644 "${BOOTSTRAP_NGINX_FILE}" "${NGINX_AVAILABLE}"
  as_root ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
  as_root nginx -t
  as_root systemctl reload nginx
  as_root certbot certonly --webroot -w "${CERT_ROOT}" -d "${API_HOSTNAME}" \
    --non-interactive --agree-tos --register-unsafely-without-email
}

install_production_site() {
  as_root install -m 0644 "${PRODUCTION_NGINX_FILE}" "${NGINX_AVAILABLE}"
  as_root ln -sfn "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
  as_root nginx -t
  as_root systemctl reload nginx
}

start_scrum_poker() {
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start "$APP_DIR/deploy/ecosystem.config.cjs" --only "$APP_NAME" --env production
  fi
  pm2 save
}

main() {
  [[ "$#" -eq 0 ]] || die "this deployer accepts no arguments."
  require_prerequisites
  validate_platform
  validate_capacity
  validate_paths_and_environment
  check_backend_port

  local keothom_state
  keothom_state="$(capture_keothom_state)"
  run_scrum_poker_checks
  install_bootstrap_site_if_needed
  install_production_site
  start_scrum_poker
  assert_keothom_state_unchanged "${keothom_state}"
}

main "$@"
