const path = require('node:path')

const platformRoot = path.resolve(process.env.CWI_PLATFORM_ROOT || path.resolve(__dirname, '../..'))
const nodePath = process.env.CWI_NODE_PATH || process.execPath
const backendRoot = path.join(platformRoot, 'cwi-backend')
const publicRouter = path.join(backendRoot, 'deploy', 'cwi-public-router.mjs')

module.exports = {
  apps: [
    {
      name: 'cwi-backend',
      cwd: backendRoot,
      script: 'dist/server.js',
      interpreter: nodePath,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '8088',
      },
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
      args: `--landing-root ${path.join(platformRoot, 'source4', 'dist')} --dashboard-root ${path.join(platformRoot, 'cwi-dashboard', 'dist')} --port 8080 --host 0.0.0.0 --api http://127.0.0.1:8088`,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '256M',
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
    },
  ],
}
