#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
GUARD="${REPO_ROOT}/deploy/scripts/egress-guard.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

[[ -x "${GUARD}" ]] || fail "egress guard is executable"
command -v jq >/dev/null 2>&1 || fail "jq is available"

VNSTAT_FIXTURE="${TMP_DIR}/vnstat-fixture.sh"
PM2_FIXTURE="${TMP_DIR}/pm2-fixture.sh"
VNSTAT_JSON="${TMP_DIR}/vnstat.json"
PM2_LOG="${TMP_DIR}/pm2.log"

cat >"${VNSTAT_FIXTURE}" <<'EOF'
#!/usr/bin/env bash
cat "${VNSTAT_JSON_FILE}"
EOF
chmod +x "${VNSTAT_FIXTURE}"

cat >"${PM2_FIXTURE}" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${PM2_LOG_FILE}"
EOF
chmod +x "${PM2_FIXTURE}"

run_guard() {
  VNSTAT_COMMAND="${VNSTAT_FIXTURE}" \
  PM2_COMMAND="${PM2_FIXTURE}" \
  VNSTAT_JSON_FILE="${VNSTAT_JSON}" \
  PM2_LOG_FILE="${PM2_LOG}" \
  FLAG_FILE="${TMP_DIR}/egress-disabled" \
  THRESHOLD_BYTES=900000000 \
  "$@" "${GUARD}"
}

write_json() {
  printf '%s\n' "$1" >"${VNSTAT_JSON}"
  rm -f "${TMP_DIR}/egress-disabled" "${PM2_LOG}"
}

write_json '{
  "interfaces": [{
    "name": "eth0",
    "traffic": {"month": [
      {"date": {"year": 2026, "month": 7}, "tx": 900000001},
      {"date": {"year": 2026, "month": 8}, "tx": 899999999}
    ]}
  }]
}'
run_guard >/dev/null || fail "below-threshold guard exits successfully"
[[ ! -e "${TMP_DIR}/egress-disabled" ]] || fail "below-threshold guard leaves flag absent"
[[ ! -e "${PM2_LOG}" ]] || fail "below-threshold guard does not invoke PM2"
pass "newest monthly counter below threshold is a no-op"

write_json '{
  "interfaces": [{
    "traffic": {"month": [
      {"date": {"year": 2026, "month": 8}, "tx": 900000000}
    ]}
  }]
}'
run_guard >/dev/null || fail "at-threshold guard exits successfully"
[[ -f "${TMP_DIR}/egress-disabled" ]] || fail "at-threshold guard creates the Scrum Poker flag"
[[ "$(cat "${PM2_LOG}")" == "stop scrum-poker-backend" ]] || fail "at-threshold guard stops only scrum-poker-backend"
pass "900000000 boundary creates the exact flag and stops the exact PM2 app"

write_json '{
  "interfaces": [{
    "traffic": {"month": [
      {"date": {"year": 2026, "month": 8}, "tx": 900000001}
    ]}
  }]
}'
DRY_RUN=true run_guard >"${TMP_DIR}/dry-run.out" || fail "dry-run guard exits successfully"
grep -Fq 'would stop scrum-poker-backend at 900000001 bytes' "${TMP_DIR}/dry-run.out" || fail "dry-run reports the exact stop target"
[[ ! -e "${TMP_DIR}/egress-disabled" ]] || fail "dry-run does not create the flag"
[[ ! -e "${PM2_LOG}" ]] || fail "dry-run does not invoke PM2"
pass "dry-run is non-mutating"

write_json '{"interfaces": ['
if run_guard >"${TMP_DIR}/malformed.out" 2>&1; then
  fail "malformed JSON fails closed"
fi
[[ ! -e "${TMP_DIR}/egress-disabled" ]] || fail "malformed JSON does not create the flag"
[[ ! -e "${PM2_LOG}" ]] || fail "malformed JSON does not invoke PM2"
pass "malformed JSON fails closed"

write_json '{
  "interfaces": [{
    "traffic": {"month": [
      {"date": {"year": 2026, "month": 8}}
    ]}
  }]
}'
if run_guard >"${TMP_DIR}/missing.out" 2>&1; then
  fail "missing tx data fails closed"
fi
[[ ! -e "${TMP_DIR}/egress-disabled" ]] || fail "missing tx data does not create the flag"
[[ ! -e "${PM2_LOG}" ]] || fail "missing tx data does not invoke PM2"
pass "missing monthly tx data fails closed"

printf 'All egress guard fixture tests passed.\n'
