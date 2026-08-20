#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly APP_DIR="/opt/scrum-poker"
readonly SERVER_DIR="${APP_DIR}/apps/server"
readonly APP_NAME="scrum-poker-backend"
readonly BACKEND_PORT="4100"
readonly EXPECTED_EXEC_PATH="${SERVER_DIR}/dist/index.js"
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

  for command_name in node pm2 nginx certbot corepack git vnstat jq ss free df awk install systemctl; do
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
  local platform_id
  platform_id="$(awk -F= '$1 == "ID" { gsub(/"/, "", $2); print $2; exit }' /etc/os-release)"
  case "${platform_id}" in
    ubuntu|debian) ;;
    *) die "Ubuntu or Debian is required; found ${platform_id:-unknown}." ;;
  esac

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "${node_major}" == "20" ]] || die "Node.js major version 20 is required; found ${node_major}."
}

parse_allowed_env() {
  local line key value required_key
  local cors_origins=""
  declare -A seen=()

  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    if [[ "${line}" == *'$('* || "${line}" == *'`'* || "${line}" == *'${'* ]]; then
      die "${ENV_FILE} contains a command substitution."
    fi
    [[ "${line}" != *[[:space:]]* ]] || die "${ENV_FILE} must not contain whitespace in assignments."
    [[ "${line}" =~ ^([A-Z_][A-Z0-9_]*)=([^=]+)$ ]] || die "${ENV_FILE} contains a malformed assignment."

    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ -z "${seen[${key}]+set}" ]] || die "${ENV_FILE} contains a duplicate environment key: ${key}."
    seen["${key}"]=1

    case "${key}" in
      PATH|PM2_HOME)
        die "${ENV_FILE} contains a forbidden process environment key: ${key}."
        ;;
      NODE_ENV)
        [[ "${value}" == "production" ]] || die "${ENV_FILE} must set NODE_ENV=production."
        ;;
      HOST)
        [[ "${value}" == "127.0.0.1" ]] || die "${ENV_FILE} must bind HOST=127.0.0.1."
        ;;
      PORT)
        [[ "${value}" == "4100" ]] || die "${ENV_FILE} must set PORT=4100."
        ;;
      CORS_ORIGINS)
        [[ "${value}" =~ ^https://[^[:space:]]+\.github\.io$ ]] || die "${ENV_FILE} must set the GitHub Pages CORS origin."
        cors_origins="${value}"
        ;;
      EGRESS_DISABLED_FILE)
        [[ "${value}" == "/var/lib/scrum-poker/egress-disabled" ]] || die "${ENV_FILE} must use the Scrum Poker maintenance flag."
        ;;
      *)
        die "${ENV_FILE} contains an unknown environment key: ${key}."
        ;;
    esac
  done < "${ENV_FILE}"

  for required_key in NODE_ENV HOST PORT CORS_ORIGINS EGRESS_DISABLED_FILE; do
    [[ -n "${seen[${required_key}]+set}" ]] || die "${ENV_FILE}: required environment key is missing: ${required_key}."
  done

  export CORS_ORIGINS="${cors_origins}"
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

  parse_allowed_env
}

pm2_backend_identity() {
  local pm2_state match_count
  pm2_state="$(pm2 jlist)" || die "could not read the PM2 process list."
  match_count="$(jq -er --arg app_name "${APP_NAME}" \
    '[.[] | select(.name == $app_name)] | length' <<<"${pm2_state}")" || die "PM2 returned an invalid process list."

  if [[ "${match_count}" == "0" ]]; then
    return 1
  fi
  [[ "${match_count}" == "1" ]] || die "PM2 must contain exactly one ${APP_NAME} entry."

  jq -e --arg app_name "${APP_NAME}" \
    --arg expected_cwd "${SERVER_DIR}" \
    --arg expected_exec_path "${EXPECTED_EXEC_PATH}" \
    '[.[] | select(.name == $app_name)] | .[0] |
      (.pm2_env.cwd == $expected_cwd and
       .pm2_env.pm_exec_path == $expected_exec_path and
       .pm2_env.status == "online")' \
    <<<"${pm2_state}" >/dev/null || die "existing ${APP_NAME} entry is wrong or offline."
}

check_backend_port() {
  if pm2_backend_identity; then
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
  node scripts/run-local-bin.mjs vitest run --config deploy/test/vitest.config.mjs deploy/test/deploy-static.test.mjs
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
  if pm2_backend_identity; then
    pm2 restart "$APP_NAME" --update-env
  else
    if ss -ltn | awk -v expected_port=":${BACKEND_PORT}" '$4 ~ expected_port "$" { found = 1 } END { exit found ? 0 : 1 }'; then
      die "port ${BACKEND_PORT} became occupied before starting ${APP_NAME}."
    fi
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
