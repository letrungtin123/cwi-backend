#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="${HOME}/.local/bin:${HOME}/.local/node/bin:${PATH}"

platform_root="${CWI_PLATFORM_ROOT:-${HOME}/cwi-platform/repos}"
mkdir -p "${platform_root}"

clone_or_pull() {
  local name="$1"
  local remote="$2"
  local target="${platform_root}/${name}"

  if [[ -e "${target}" && ! -d "${target}/.git" ]]; then
    echo "Refusing to use non-Git directory: ${target}" >&2
    exit 1
  fi

  if [[ -d "${target}/.git" ]]; then
    git -C "${target}" fetch --prune origin main
    git -C "${target}" pull --ff-only origin main
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

clone_or_pull source4 https://github.com/letrungtin123/cwi-fe.git
clone_or_pull cwi-dashboard https://github.com/letrungtin123/cwi-dashboard.git
clone_or_pull cwi-backend https://github.com/letrungtin123/cwi-backend.git

copy_env_if_missing source4
copy_env_if_missing cwi-dashboard
copy_env_if_missing cwi-backend

for app in source4 cwi-dashboard cwi-backend; do
  npm --prefix "${platform_root}/${app}" ci --no-audit --no-fund
done

npm --prefix "${platform_root}/source4" run build
npm --prefix "${platform_root}/cwi-dashboard" run build
npm --prefix "${platform_root}/cwi-backend" run build

if ! command -v pm2 >/dev/null 2>&1; then
  echo 'pm2 is required on the server' >&2
  exit 1
fi

CWI_PLATFORM_ROOT="${platform_root}" pm2 startOrReload \
  "${platform_root}/cwi-backend/deploy/ecosystem.config.cjs" \
  --update-env
pm2 save

for attempt in {1..15}; do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8088/health >/dev/null; then
    break
  fi
  if [[ "${attempt}" == '15' ]]; then
    echo 'Backend health check failed after deployment' >&2
    exit 1
  fi
  sleep 2
done

curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/ >/dev/null
echo "Production update completed from Git main at ${platform_root}"
