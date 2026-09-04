const path = require('node:path')

const platformRoot = path.resolve(process.env.CWI_PLATFORM_ROOT || path.resolve(__dirname, '../..'))
const nodePath = process.env.CWI_NODE_PATH || '/home/ubuntu/.local/bin/node'
const backendRoot = path.join(platformRoot, 'cwi-backend')
const publicRouter = path.join(backendRoot, 'deploy', 'cwi-public-router.mjs')
const nodeEnv = process.env.CWI_NODE_ENV || 'development'
const publicOrigin = process.env.CWI_PUBLIC_ORIGIN || 'https://ceo-workforce-index.com'
const productionBackendEnv = {
  AUTH_COOKIE_SAME_SITE: 'lax',
  AUTH_COOKIE_SECURE: 'true',
  CORS_ALLOWED_ORIGINS: process.env.CWI_CORS_ALLOWED_ORIGINS || publicOrigin,
}

module.exports = {
  apps: [
    {
      name: 'cwi-backend',
      cwd: backendRoot,
      script: 'deploy/start-backend.mjs',
      interpreter: nodePath,
      env: { NODE_ENV: nodeEnv, HOST: '127.0.0.1', PORT: '8088' },
      env_production: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '8088', ...productionBackendEnv },
      autorestart: true,
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
    {
      name: 'cwi-export-worker',
      cwd: backendRoot,
      script: 'deploy/start-export-worker.mjs',
      interpreter: nodePath,
      env: { NODE_ENV: nodeEnv },
      env_production: { NODE_ENV: 'production', ...productionBackendEnv },
      autorestart: true,
      max_memory_restart: '768M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
    {
      name: 'cwi-report-delivery-worker',
      cwd: backendRoot,
      script: 'deploy/start-report-delivery-worker.mjs',
      interpreter: nodePath,
      env: { NODE_ENV: nodeEnv },
      env_production: { NODE_ENV: 'production', ...productionBackendEnv },
      autorestart: true,
      max_memory_restart: '512M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
    {
      name: 'cwi-public',
      cwd: platformRoot,
      script: publicRouter,
      interpreter: nodePath,
      args:
        '--landing-root ' + path.join(platformRoot, 'source4', 'dist') +
        ' --dashboard-root ' + path.join(platformRoot, 'cwi-dashboard', 'dist') +
        ' --port 8080 --host 0.0.0.0 --api http://127.0.0.1:8088',
      env: { NODE_ENV: nodeEnv },
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '256M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
    {
      name: 'cwi-report-generation-worker',
      cwd: backendRoot,
      script: 'deploy/start-report-generation-worker.mjs',
      interpreter: nodePath,
      env: { NODE_ENV: nodeEnv },
      env_production: { NODE_ENV: 'production', ...productionBackendEnv },
      autorestart: true,
      max_memory_restart: '768M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
  ],
}
