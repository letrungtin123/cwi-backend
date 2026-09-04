#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="${HOME}/.local/bin:${HOME}/.local/node/bin:${PATH}"

platform_root="${CWI_PLATFORM_ROOT:-${HOME}/cwi-platform/repos}"
release_root="${CWI_RELEASE_ROOT:-${HOME}/cwi-platform/releases}"
current_link="${release_root}/current"
export CWI_NODE_ENV="${CWI_NODE_ENV:-production}"
export CWI_PUBLIC_ORIGIN="${CWI_PUBLIC_ORIGIN:-https://ceo-workforce-index.com}"
release_id="$(date -u +%Y%m%d%H%M%S)"
release_dir="${release_root}/${release_id}"
staged_backend_port="${CWI_STAGED_BACKEND_PORT:-18088}"
staged_public_port="${CWI_STAGED_PUBLIC_PORT:-18080}"
previous_release=""
backend_pid=""
public_pid=""
rollout_started=0
rollout_succeeded=0

mkdir -p "${platform_root}" "${release_root}"

if [[ -L "${current_link}" ]]; then
  previous_release="$(readlink -f "${current_link}" || true)"
fi
if [[ -z "${previous_release}" ]]; then
  previous_release="${platform_root}"
fi

cleanup() {
  if [[ -n "${backend_pid}" ]]; then kill "${backend_pid}" >/dev/null 2>&1 || true; fi
  if [[ -n "${public_pid}" ]]; then kill "${public_pid}" >/dev/null 2>&1 || true; fi

  if [[ "${rollout_succeeded}" != '1' && -d "${release_dir}" ]]; then
    for app in source4 cwi-dashboard cwi-backend; do
      if [[ -d "${release_dir}/${app}" ]]; then
        git -C "${platform_root}/${app}" worktree remove --force "${release_dir}/${app}" >/dev/null 2>&1 || true
      fi
    done
    rm -f "${release_dir}/backend-smoke.log" "${release_dir}/public-smoke.log"
    rmdir "${release_dir}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

clone_or_fetch() {
  local name="$1"
  local remote="$2"
  local target="${platform_root}/${name}"

  if [[ -e "${target}" && ! -d "${target}/.git" ]]; then
    echo "Refusing to use non-Git directory: ${target}" >&2
    exit 1
  fi

  if [[ -d "${target}/.git" ]]; then
    if [[ -n "$(git -C "${target}" status --porcelain)" ]]; then
      echo "Refusing to deploy with dirty repository: ${target}" >&2
      exit 1
    fi
    git -C "${target}" fetch --prune origin main
  else
    git clone --branch main --single-branch "${remote}" "${target}"
  fi
}

copy_env_if_missing() {
  local name="$1"
  local target="${platform_root}/${name}/.env"
  local legacy="${HOME}/cwi-platform/current/${name}/.env"

  if [[ ! -f "${target}" && -f "${legacy}" ]]; then
    install -m 600 "${legacy}" "${target}"
    echo "Copied existing server env for ${name}"
  fi
}

create_worktree() {
  local name="$1"
  local source="${platform_root}/${name}"
  local target="${release_dir}/${name}"

  git -C "${source}" worktree add --detach "${target}" origin/main >/dev/null
  if [[ -f "${source}/.env" ]]; then
    ln -s "${source}/.env" "${target}/.env"
  fi
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-30}"
  for attempt in $(seq 1 "${attempts}"); do
    if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_release() {
  local root="$1"
  CWI_PLATFORM_ROOT="${root}" \
  CWI_NODE_ENV="${CWI_NODE_ENV}" \
  CWI_PUBLIC_ORIGIN="${CWI_PUBLIC_ORIGIN}" \
  pm2 start \
    "${root}/cwi-backend/deploy/ecosystem.config.cjs" \
    --env production \
    --update-env
}

rollback_pm2() {
  if [[ "${rollout_started}" != '1' ]]; then return 0; fi
  echo "Health check failed; attempting PM2 rollback to ${previous_release}" >&2
  pm2 delete cwi-backend >/dev/null 2>&1 || true
  pm2 delete cwi-public >/dev/null 2>&1 || true
  pm2 delete cwi-report-generation-worker >/dev/null 2>&1 || true
  pm2 delete cwi-report-delivery-worker >/dev/null 2>&1 || true
  start_release "${previous_release}"
  pm2 save >/dev/null
}

clone_or_fetch source4 https://github.com/letrungtin123/cwi-fe.git
clone_or_fetch cwi-dashboard https://github.com/letrungtin123/cwi-dashboard.git
clone_or_fetch cwi-backend https://github.com/letrungtin123/cwi-backend.git

copy_env_if_missing source4
copy_env_if_missing cwi-dashboard
copy_env_if_missing cwi-backend

if [[ ! -f "${platform_root}/cwi-backend/.env" ]]; then
  echo "Missing backend environment file: ${platform_root}/cwi-backend/.env" >&2
  exit 1
fi

mkdir -p "${release_dir}"
create_worktree source4
create_worktree cwi-dashboard
create_worktree cwi-backend

for app in source4 cwi-dashboard cwi-backend; do
  npm --prefix "${release_dir}/${app}" ci --no-audit --no-fund
done

npm --prefix "${release_dir}/source4" run build
npm --prefix "${release_dir}/cwi-dashboard" run build
npm --prefix "${release_dir}/cwi-backend" run build

if ! command -v pm2 >/dev/null 2>&1; then
  echo 'pm2 is required on the server' >&2
  exit 1
fi

(
  cd "${release_dir}/cwi-backend"
  NODE_ENV=production HOST=127.0.0.1 PORT="${staged_backend_port}" \
    node deploy/start-backend.mjs >"${release_dir}/backend-smoke.log" 2>&1
) &
backend_pid="$!"

if ! wait_for_url "http://127.0.0.1:${staged_backend_port}/healthz" 30; then
  echo 'Staged backend liveness check failed' >&2
  cat "${release_dir}/backend-smoke.log" >&2 || true
  exit 1
fi
if ! wait_for_url "http://127.0.0.1:${staged_backend_port}/readyz" 30; then
  echo 'Staged backend readiness check failed' >&2
  cat "${release_dir}/backend-smoke.log" >&2 || true
  exit 1
fi
kill "${backend_pid}" >/dev/null 2>&1 || true
wait "${backend_pid}" >/dev/null 2>&1 || true
backend_pid=""

(
  cd "${release_dir}/cwi-backend"
  node deploy/cwi-public-router.mjs \
    --landing-root "${release_dir}/source4/dist" \
    --dashboard-root "${release_dir}/cwi-dashboard/dist" \
    --port "${staged_public_port}" \
    --host 127.0.0.1 \
    --api "http://127.0.0.1:${staged_backend_port}" \
    >"${release_dir}/public-smoke.log" 2>&1
) &
public_pid="$!"

if ! wait_for_url "http://127.0.0.1:${staged_public_port}/" 30; then
  echo 'Staged landing check failed' >&2
  cat "${release_dir}/public-smoke.log" >&2 || true
  exit 1
fi
if ! wait_for_url "http://127.0.0.1:${staged_public_port}/dashboard/" 30; then
  echo 'Staged dashboard check failed' >&2
  cat "${release_dir}/public-smoke.log" >&2 || true
  exit 1
fi
kill "${public_pid}" >/dev/null 2>&1 || true
wait "${public_pid}" >/dev/null 2>&1 || true
public_pid=""

rollout_started=1
pm2 stop cwi-backend >/dev/null 2>&1 || true
pm2 stop cwi-export-worker >/dev/null 2>&1 || true
pm2 stop cwi-public >/dev/null 2>&1 || true
pm2 stop cwi-report-generation-worker >/dev/null 2>&1 || true
pm2 stop cwi-report-delivery-worker >/dev/null 2>&1 || true
pm2 delete cwi-backend >/dev/null 2>&1 || true
pm2 delete cwi-export-worker >/dev/null 2>&1 || true
pm2 delete cwi-public >/dev/null 2>&1 || true
pm2 delete cwi-report-generation-worker >/dev/null 2>&1 || true
pm2 delete cwi-report-delivery-worker >/dev/null 2>&1 || true
start_release "${release_dir}"
pm2 save

if ! wait_for_url http://127.0.0.1:8088/healthz 30 || ! wait_for_url http://127.0.0.1:8088/readyz 30 || ! wait_for_url http://127.0.0.1:8080/ 30 || ! wait_for_url http://127.0.0.1:8080/dashboard/ 30; then
  rollback_pm2
  exit 1
fi

ln -sfn "${release_dir}" "${current_link}"
rollout_succeeded=1
echo "Production update completed from Git origin/main at ${release_dir}"
