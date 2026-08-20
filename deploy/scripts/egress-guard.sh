#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_NAME="scrum-poker-backend"
readonly DEFAULT_THRESHOLD_BYTES=900000000
readonly VNSTAT_COMMAND="${VNSTAT_COMMAND:-vnstat}"
readonly PM2_COMMAND="${PM2_COMMAND:-pm2}"
readonly FLAG_FILE="${FLAG_FILE:-/var/lib/scrum-poker/egress-disabled}"
readonly DRY_RUN="${DRY_RUN:-false}"
readonly THRESHOLD_BYTES="${THRESHOLD_BYTES:-${DEFAULT_THRESHOLD_BYTES}}"

fail_closed() {
  printf 'egress guard: %s\n' "$1" >&2
  exit 1
}

[[ "${THRESHOLD_BYTES}" =~ ^[0-9]+$ ]] || fail_closed "THRESHOLD_BYTES must be a non-negative integer"
[[ "${THRESHOLD_BYTES}" != "" ]] || fail_closed "THRESHOLD_BYTES must not be empty"

case "${DRY_RUN}" in
  true|false) ;;
  *) fail_closed "DRY_RUN must be true or false" ;;
esac

vnstat_json=''
if ! vnstat_json="$("${VNSTAT_COMMAND}" --json m 1)"; then
  fail_closed "vnstat command failed"
fi

tx_bytes=''
if ! tx_bytes="$(printf '%s' "${vnstat_json}" | jq -er '
  def nonnegative_integer($label):
    if type != "number" then error($label + " must be numeric")
    elif (isfinite | not) then error($label + " must be finite")
    elif . < 0 or floor != . then error($label + " must be an integer")
    else .
    end;

  .interfaces
  | if type != "array" or length < 1 then error("interfaces missing") else .[0] end
  | .traffic.month
  | if type != "array" or length < 1 then error("monthly traffic missing") else . end
  | max_by(
      ((.date.year | nonnegative_integer("year")) * 12)
      + (.date.month | nonnegative_integer("month"))
    )
  | .tx
  | nonnegative_integer("tx")
  | tostring
')"; then
  fail_closed "vnstat JSON is malformed or missing a monthly tx counter"
fi

[[ "${tx_bytes}" =~ ^[0-9]+$ ]] || fail_closed "vnstat tx counter is not a non-negative integer"

tx_value=$((10#${tx_bytes}))
threshold_value=$((10#${THRESHOLD_BYTES}))

if (( tx_value < threshold_value )); then
  printf 'egress guard: %s bytes below threshold %s\n' "${tx_bytes}" "${THRESHOLD_BYTES}"
  exit 0
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  printf 'would stop %s at %s bytes\n' "${APP_NAME}" "${tx_bytes}"
  exit 0
fi

install -D -m 0644 /dev/null "${FLAG_FILE}" || fail_closed "could not create maintenance flag"
if ! "${PM2_COMMAND}" stop "${APP_NAME}"; then
  fail_closed "could not stop ${APP_NAME}"
fi

printf 'egress guard: maintenance flag created and %s stopped at %s bytes\n' "${APP_NAME}" "${tx_bytes}"
