# Production Deployment

The server deployment is Git-based. Source changes are made locally, reviewed, committed, and pushed to `main`; the server only runs `deploy/update-production.sh` to fast-forward the three repositories and build them.

The script expects these repositories under `${CWI_PLATFORM_ROOT:-$HOME/cwi-platform/repos}`:

- `source4` from `https://github.com/letrungtin123/cwi-fe.git`
- `cwi-dashboard` from `https://github.com/letrungtin123/cwi-dashboard.git`
- `cwi-backend` from `https://github.com/letrungtin123/cwi-backend.git`

Production `.env` files are kept on the server and are copied from the legacy deployment only when the new Git checkout does not have one. They are never committed.

For the current IP-only HTTP test deployment, CWI_NODE_ENV defaults to development so session cookies remain usable. Before exposing the service as production, configure HTTPS and run CWI_NODE_ENV=production bash deploy/update-production.sh; production validation requires AUTH_COOKIE_SECURE=true.

The backend and the combined public router are managed by PM2. The router serves both frontend `dist` directories and proxies `/api` to the loopback backend. It requests an uncompressed upstream response so the browser receives a valid JSON body.

```bash
cd "$HOME/cwi-platform/repos/cwi-backend"
bash deploy/update-production.sh
```
