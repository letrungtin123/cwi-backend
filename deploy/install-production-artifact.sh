#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="${HOME}/.local/bin:${HOME}/.local/node/bin:${PATH}"

artifact=''
platform_root="${CWI_PLATFORM_ROOT:-${HOME}/cwi-platform}"
release_root="${CWI_RELEASE_ROOT:-${platform_root}/releases}"
current_link="${CWI_CURRENT_LINK:-${release_root}/current}"
env_file="${CWI_ENV_FILE:-${HOME}/.config/cwi/cwi-backend.env}"
release_id=''
staged_backend_port="${CWI_STAGED_BACKEND_PORT:-18088}"
staged_public_port="${CWI_STAGED_PUBLIC_PORT:-18080}"
public_origin="${CWI_PUBLIC_ORIGIN:-https://ceo-workforce-index.com}"
prune_legacy_source='false'
prune_artifacts='3'
backend_pid=''
public_pid=''
rollout_started='false'

usage() {
  cat <<'EOF'
Usage: install-production-artifact.sh --artifact PATH [options]

Options:
  --artifact PATH                 Local artifact path on this server (required)
  --platform-root PATH            Platform root, default: $HOME/cwi-platform
  --release-root PATH             Release root, default: PLATFORM_ROOT/releases
  --env-file PATH                 External backend env file, default: $HOME/.config/cwi/cwi-backend.env
  --release-id ID                 Release id; defaults to marker value
  --prune-legacy-source           Remove the three legacy Git checkouts after success
  --prune-artifacts COUNT         Keep this many artifact releases, default: 3
EOF
}

fail() { echo "Artifact deployment failed: $*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --artifact) artifact="${2:?Missing value for --artifact}"; shift 2 ;;
    --platform-root) platform_root="${2:?Missing value for --platform-root}"; shift 2 ;;
    --release-root) release_root="${2:?Missing value for --release-root}"; shift 2 ;;
    --env-file) env_file="${2:?Missing value for --env-file}"; shift 2 ;;
    --release-id) release_id="${2:?Missing value for --release-id}"; shift 2 ;;
    --prune-legacy-source) prune_legacy_source='true'; shift ;;
    --prune-artifacts) prune_artifacts="${2:?Missing value for --prune-artifacts}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[[ -n "$artifact" && -f "$artifact" ]] || fail 'A readable artifact is required.'
[[ "$prune_artifacts" =~ ^[0-9]+$ ]] || fail '--prune-artifacts must be a non-negative integer.'
command -v node >/dev/null || fail 'node is required.'
command -v npm >/dev/null || fail 'npm is required.'
command -v pm2 >/dev/null || fail 'pm2 is required.'
command -v curl >/dev/null || fail 'curl is required.'
command -v tar >/dev/null || fail 'tar is required.'
command -v sha256sum >/dev/null || fail 'sha256sum is required.'

mkdir -p "$release_root" "$(dirname "$env_file")"
if [[ ! -f "$env_file" ]]; then
  legacy_env="${platform_root}/repos/cwi-backend/.env"
  [[ -f "$legacy_env" ]] || fail "Missing external env file: $env_file"
  install -m 600 "$legacy_env" "$env_file"
fi
chmod 600 "$env_file"

if tar -tzf "$artifact" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  fail 'Artifact contains an unsafe path.'
fi

stage_dir="${release_root}/.stage-${release_id:-$$}"
rm -rf "$stage_dir"
mkdir -p "$stage_dir"
cleanup() {
  [[ -z "$backend_pid" ]] || kill "$backend_pid" >/dev/null 2>&1 || true
  [[ -z "$public_pid" ]] || kill "$public_pid" >/dev/null 2>&1 || true
  [[ -z "$backend_pid" ]] || wait "$backend_pid" >/dev/null 2>&1 || true
  [[ -z "$public_pid" ]] || wait "$public_pid" >/dev/null 2>&1 || true
  [[ -d "$stage_dir" ]] && rm -rf "$stage_dir"
}
trap cleanup EXIT

tar -xzf "$artifact" -C "$stage_dir"
[[ -f "$stage_dir/release.json" ]] || fail 'Artifact marker is missing.'
[[ -f "$stage_dir/manifest.sha256" ]] || fail 'Artifact checksum manifest is missing.'
(cd "$stage_dir" && sha256sum -c manifest.sha256 >/dev/null) || fail 'Artifact checksum verification failed.'

if find "$stage_dir" -path '*/node_modules' -prune -o -type d \( -name .git -o -name src \) -print -quit | grep -q .; then
  fail 'Artifact contains raw source or Git metadata.'
fi
for required in \
  "$stage_dir/source4/dist/index.html" \
  "$stage_dir/cwi-dashboard/dist/index.html" \
  "$stage_dir/cwi-backend/dist/server.js" \
  "$stage_dir/cwi-backend/deploy/ecosystem.config.cjs" \
  "$stage_dir/cwi-backend/package-lock.json"; do
  [[ -f "$required" ]] || fail "Artifact is incomplete: $required"
done

if [[ -z "$release_id" ]]; then
  release_id="$(node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(x.releaseId)" "$stage_dir/release.json")"
fi
[[ "$release_id" =~ ^[0-9A-Za-z._-]+$ ]] || fail 'Invalid release id.'
release_dir="${release_root}/${release_id}"
[[ ! -e "$release_dir" ]] || fail "Release already exists: $release_dir"
mv "$stage_dir" "$release_dir"
stage_dir=''

(
  cd "$release_dir/cwi-backend"
  npm ci --omit=dev --no-audit --no-fund
)

previous_release=''
if [[ -L "$current_link" ]]; then previous_release="$(readlink -f "$current_link" || true)"; fi
if [[ -z "$previous_release" && -d "${platform_root}/repos/cwi-backend" ]]; then
  previous_release="${platform_root}/repos"
fi

wait_for_url() {
  local url="$1"
  local attempts="${2:-30}"
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

start_smoke_backend() {
  (
    cd "$release_dir/cwi-backend"
    NODE_ENV=production CWI_ENV_FILE="$env_file" DOTENV_CONFIG_PATH="$env_file" CWI_PLATFORM_ROOT="$release_dir" \
      HOST=127.0.0.1 PORT="$staged_backend_port" node deploy/start-backend.mjs \
      >"$release_root/.artifact-backend-smoke.log" 2>&1
  ) &
  backend_pid="$!"
}

start_smoke_public() {
  (
    cd "$release_dir/cwi-backend"
    NODE_ENV=production CWI_PLATFORM_ROOT="$release_dir" \
      node deploy/cwi-public-router.mjs \
      --landing-root "$release_dir/source4/dist" \
      --dashboard-root "$release_dir/cwi-dashboard/dist" \
      --port "$staged_public_port" --host 127.0.0.1 \
      --api "http://127.0.0.1:${staged_backend_port}" \
      >"$release_root/.artifact-public-smoke.log" 2>&1
  ) &
  public_pid="$!"
}

stop_smoke_processes() {
  [[ -z "$backend_pid" ]] || kill "$backend_pid" >/dev/null 2>&1 || true
  [[ -z "$public_pid" ]] || kill "$public_pid" >/dev/null 2>&1 || true
  [[ -z "$backend_pid" ]] || wait "$backend_pid" >/dev/null 2>&1 || true
  [[ -z "$public_pid" ]] || wait "$public_pid" >/dev/null 2>&1 || true
  backend_pid=''
  public_pid=''
}

start_release() {
  local root="$1"
  CWI_PLATFORM_ROOT="$root" CWI_ENV_FILE="$env_file" DOTENV_CONFIG_PATH="$env_file" CWI_NODE_ENV=production CWI_PUBLIC_ORIGIN="$public_origin" \
    pm2 start "$root/cwi-backend/deploy/ecosystem.config.cjs" --env production --update-env
}

rollback() {
  [[ "$rollout_started" == 'true' ]] || return 0
  [[ -n "$previous_release" && -d "$previous_release" ]] || return 0
  pm2 delete cwi-backend cwi-export-worker cwi-public cwi-report-generation-worker cwi-report-delivery-worker >/dev/null 2>&1 || true
  start_release "$previous_release" >/dev/null
  pm2 save >/dev/null
}

trap 'if [[ "$rollout_started" == "true" ]]; then rollback; fi; cleanup' EXIT

start_smoke_backend
if ! wait_for_url "http://127.0.0.1:${staged_backend_port}/healthz" 30 || ! wait_for_url "http://127.0.0.1:${staged_backend_port}/readyz" 30; then
  fail 'Staged backend health check failed.'
fi
start_smoke_public
if ! wait_for_url "http://127.0.0.1:${staged_public_port}/" 30 || ! wait_for_url "http://127.0.0.1:${staged_public_port}/dashboard/" 30; then
  fail 'Staged frontend health check failed.'
fi
stop_smoke_processes

rollout_started='true'
pm2 delete cwi-backend cwi-export-worker cwi-public cwi-report-generation-worker cwi-report-delivery-worker >/dev/null 2>&1 || true
start_release "$release_dir"
pm2 save >/dev/null

if ! wait_for_url 'http://127.0.0.1:8088/healthz' 30 || ! wait_for_url 'http://127.0.0.1:8088/readyz' 30 || ! wait_for_url 'http://127.0.0.1:8080/' 30 || ! wait_for_url 'http://127.0.0.1:8080/dashboard/' 30; then
  fail 'Production health check failed; rollback was attempted.'
fi

ln -sfn "$release_dir" "$current_link"
rollout_started='false'
rm -f "$release_root/.artifact-backend-smoke.log" "$release_root/.artifact-public-smoke.log"
rm -f "$artifact"

if [[ "$prune_artifacts" -gt 0 ]]; then
  mapfile -t old_artifacts < <(find "$release_root" -mindepth 1 -maxdepth 1 -type f -name '.artifact-release' -printf '%h\n' | sort -r | tail -n +$((prune_artifacts + 1)))
  for old_release in "${old_artifacts[@]:-}"; do
    [[ -n "$old_release" ]] && rm -rf "$old_release"
  done
fi

if [[ "$prune_legacy_source" == 'true' ]]; then
  [[ "$(readlink -f "$current_link")" != "${platform_root}/repos"/* ]] || fail 'Refusing to remove legacy source while current points to it.'
  for app in source4 cwi-dashboard cwi-backend; do
    [[ -d "${platform_root}/repos/${app}" ]] && rm -rf "${platform_root}/repos/${app}"
  done
  find "$release_root" -mindepth 1 -maxdepth 1 -type d ! -path "$release_dir" ! -path "$release_root/current" \
    ! -exec test -f '{}/.artifact-release' \; -print0 | xargs -0r rm -rf
fi

trap - EXIT
echo "Production artifact installed: $release_dir"
