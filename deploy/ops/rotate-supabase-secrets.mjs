#!/usr/bin/env node
// Rotates every default secret of a Supabase CLI stack in place, without the Supabase CLI:
//   - JWT secret, ES256 signing key, anon/service_role keys, sb_publishable/sb_secret keys
//   - passwords of every login role in Postgres
// and creates a least-privilege role `cwi_app` for the CWI backend.
//
// The containers auth, rest and storage are re-created from their own `docker inspect`
// (same image, networks, aliases, ports, volumes, restart policy, health check); only the
// secrets in their environment change. The db container is not touched: role passwords change
// through SQL. The old containers are kept (renamed, stopped) for rollback.
//
// Kong is managed by another team and is NOT changed. It only forwards requests; the CWI backend
// sends its JWT itself, so Kong needs no change. The demo sb_publishable/sb_secret keys in
// kong.yml map to the old demo JWTs, which stop working once the JWT secret changes.
//
// Never prints a secret. Secrets are written only to the --secrets file (mode 600).
//
// Usage: node rotate-supabase-secrets.mjs <plan|app-role|rotate|rollback|backend-env|verify> \
//          --project supabase-cwi --secrets <file.json> --work <dir> [--env-file <backend .env>] \
//          [--api-url http://127.0.0.1:55321]
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const args = process.argv.slice(2)
const mode = args[0]
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const project = opt('project', 'supabase-cwi')
const secretsFile = opt('secrets')
const workDir = opt('work')
const envFile = opt('env-file')
const apiUrl = opt('api-url', 'http://127.0.0.1:55321')
if (!mode || !secretsFile || !workDir) {
  console.error('usage: rotate-supabase-secrets.mjs <mode> --secrets <file> --work <dir> [--env-file <file>]')
  process.exit(2)
}

const names = {
  auth: `supabase_auth_${project}`,
  db: `supabase_db_${project}`,
  kong: `supabase_kong_${project}`,
  rest: `supabase_rest_${project}`,
  storage: `supabase_storage_${project}`,
}
const recreated = ['rest', 'auth', 'storage']

function log(message) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`)
}
function fail(message) {
  console.error(`FAILED: ${message}`)
  process.exit(1)
}
function docker(...dockerArgs) {
  return execFileSync('docker', dockerArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
function writePrivate(file, content) {
  writeFileSync(file, content, { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* Windows */ }
}
function inspect(name) {
  return JSON.parse(docker('inspect', name))[0]
}
const envOf = (container) => Object.fromEntries(container.Config.Env.map((line) => {
  const i = line.indexOf('=')
  return [line.slice(0, i), line.slice(i + 1)]
}))

// --- psql through the db container's local socket (trusted for supabase_admin) ---------------
function psql(sql) {
  return execFileSync('docker', ['exec', '-i', names.db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], {
    encoding: 'utf8',
    input: `SET log_statement = 'none';\n${sql}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

// --- secret material ---------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url')
const alnum = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  while (out.length < length) for (const byte of randomBytes(length)) if (byte < 248 && out.length < length) out += chars[byte % 62]
  return out
}
function signHs256(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return `${header}.${body}.${b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())}`
}
// Postgres accepts a pre-computed SCRAM verifier, so the plain password never reaches the server.
function scramVerifier(password) {
  const salt = randomBytes(16)
  const iterations = 4096
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const clientKey = createHmac('sha256', salted).update('Client Key').digest()
  const storedKey = createHash('sha256').update(clientKey).digest()
  const serverKey = createHmac('sha256', salted).update('Server Key').digest()
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}

// --- read the current (old) secrets from the running stack -------------------------------------
function readCurrent() {
  const containers = Object.fromEntries(recreated.map((key) => [key, inspect(names[key])]))
  const authEnv = envOf(containers.auth)
  const storageEnv = envOf(containers.storage)
  // Read-only: the demo sb_ keys are only used to check afterwards that they no longer work.
  const kongYml = docker('exec', names.kong, 'cat', '/home/kong/kong.yml')
  const ecKeys = JSON.parse(authEnv.GOTRUE_JWT_KEYS || '[]').filter((k) => k.kty === 'EC')
  const sbKeys = [...new Set(kongYml.match(/sb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/g) || [])]
  const dbPasswords = {}
  for (const key of recreated) {
    for (const value of Object.values(envOf(containers[key]))) {
      for (const m of value.matchAll(/postgres(?:ql)?:\/\/([^:/@\s]+):([^@\s]+)@/g)) dbPasswords[m[1]] = decodeURIComponent(m[2])
    }
  }
  const loginRoles = psql("select string_agg(rolname, ' ' order by rolname) from pg_roles where rolcanlogin and rolname <> 'cwi_app'").split(' ').filter(Boolean)
  return {
    anonKey: storageEnv.ANON_KEY,
    containers,
    dbPasswords,
    ecKeys,
    jwtSecret: authEnv.GOTRUE_JWT_SECRET,
    kongYml,
    loginRoles,
    sbKeys,
    serviceRoleKey: storageEnv.SERVICE_KEY,
  }
}

function generate(current) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 10 * 365 * 24 * 3600
  const jwtSecret = b64url(randomBytes(48))
  const ec = current.ecKeys.map((old) => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = privateKey.export({ format: 'jwk' })
    return { old: { d: old.d, kid: old.kid, x: old.x, y: old.y }, next: { d: jwk.d, kid: randomUUID(), x: jwk.x, y: jwk.y } }
  })
  const sbKeys = current.sbKeys.map((old) => ({ old }))
  const rolePasswords = Object.fromEntries(current.loginRoles.map((role) => [role, alnum(40)]))
  return {
    anonKey: signHs256({ exp, iat: now, iss: 'supabase', role: 'anon' }, jwtSecret),
    cwiAppPassword: alnum(40),
    ec,
    generatedAt: new Date().toISOString(),
    jwtSecret,
    rolePasswords,
    sbKeys,
    serviceRoleKey: signHs256({ exp, iat: now, iss: 'supabase', role: 'service_role' }, jwtSecret),
  }
}

// Every old secret string and its replacement, applied to the environment of the services.
function replacements(current, next) {
  const list = [
    ['jwt secret', current.jwtSecret, next.jwtSecret],
    ['jwt secret (JWK k)', b64url(current.jwtSecret), b64url(next.jwtSecret)],
    ['anon key', current.anonKey, next.anonKey],
    ['service_role key', current.serviceRoleKey, next.serviceRoleKey],
  ]
  for (const pair of next.ec) for (const field of ['d', 'kid', 'x', 'y']) list.push([`ES256 ${field}`, pair.old[field], pair.next[field]])
  return list.filter(([, from]) => from)
}
function rewrite(text, list, current, next, counts) {
  let out = text
  for (const [label, from, to] of list) {
    const n = out.split(from).length - 1
    if (n) {
      counts[label] = (counts[label] || 0) + n
      out = out.split(from).join(to)
    }
  }
  // Database URLs: user:password@ for each role the services use.
  out = out.replace(/(postgres(?:ql)?:\/\/)([^:/@\s]+):([^@\s]+)@/g, (all, scheme, user, pw) => {
    const replacement = next.rolePasswords[user]
    if (!replacement || decodeURIComponent(pw) !== current.dbPasswords[user]) return all
    counts[`db url ${user}`] = (counts[`db url ${user}`] || 0) + 1
    return `${scheme}${user}:${replacement}@`
  })
  return out
}

function buildNew(current, next) {
  const list = replacements(current, next)
  const counts = {}
  const env = {}
  for (const key of recreated) {
    env[key] = current.containers[key].Config.Env.map((line) => rewrite(line, list, current, next, counts))
  }
  // Nothing old may survive anywhere in the re-created services.
  const leftovers = []
  const haystacks = Object.values(env).flat()
  for (const [label, from] of list) if (from.length >= 16 && haystacks.some((h) => h.includes(from))) leftovers.push(label)
  for (const key of recreated) for (const line of env[key]) for (const m of line.matchAll(/postgres(?:ql)?:\/\/([^:/@\s]+):([^@\s]+)@/g)) {
    if (decodeURIComponent(m[2]) === current.dbPasswords[m[1]]) leftovers.push(`db url ${m[1]} in ${key}`)
  }
  return { counts, env, leftovers }
}

// --- Docker Engine API (create only; everything else through the CLI) --------------------------
function dockerHost() {
  const host = docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').trim()
  if (host.startsWith('unix://')) return { socketPath: host.slice('unix://'.length) }
  if (host.startsWith('npipe://')) return { socketPath: host.slice('npipe://'.length).replace(/\//g, '\\') }
  fail(`unsupported docker host ${host}`)
}
function engine(method, urlPath, body) {
  const { socketPath } = dockerHost()
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const req = http.request({ headers: payload ? { 'content-length': Buffer.byteLength(payload), 'content-type': 'application/json' } : {}, method, path: urlPath, socketPath }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => (res.statusCode >= 300 ? reject(new Error(`${method} ${urlPath} -> ${res.statusCode} ${data.slice(0, 300)}`)) : resolve(data ? JSON.parse(data) : null)))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}
// The new container keeps the old one's IP address: Kong resolves upstream names once and keeps
// the IP, so a container that comes back on another address is unreachable through Kong (seen
// on prod 2026-11-13: 502 until the IPs were restored). The old container must be stopped first.
async function createLike(old, name, env) {
  const config = { ...old.Config, Env: env }
  delete config.Hostname
  const networks = Object.fromEntries(Object.entries(old.NetworkSettings.Networks).map(([net, ep]) => [net, {
    Aliases: (ep.Aliases || []).filter((a) => !old.Id.startsWith(a)),
    IPAMConfig: { ...(ep.IPAMConfig || {}), ...(ep.IPAddress ? { IPv4Address: ep.IPAddress } : {}) },
  }]))
  const [firstNet, ...otherNets] = Object.entries(networks)
  const created = await engine('POST', `/containers/create?name=${encodeURIComponent(name)}`, {
    ...config,
    HostConfig: old.HostConfig,
    NetworkingConfig: { EndpointsConfig: Object.fromEntries([firstNet]) },
  })
  for (const [net, ep] of otherNets) await engine('POST', `/networks/${encodeURIComponent(net)}/connect`, { Container: created.Id, EndpointConfig: ep })
  return created.Id
}
async function waitHealthy(name, seconds = 120) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    const state = inspect(name).State
    if (state.Health ? state.Health.Status === 'healthy' : state.Running) return true
    if (state.Status === 'exited') return false
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

// --- modes --------------------------------------------------------------------------------------
mkdirSync(workDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)

if (mode === 'plan' || mode === 'rotate') {
  const current = readCurrent()
  if (!current.jwtSecret || !current.anonKey || !current.serviceRoleKey) fail('could not read the current JWT secret or keys')
  let next
  if (existsSync(secretsFile)) {
    next = JSON.parse(readFileSync(secretsFile, 'utf8'))
    if (next.rotatedAt) fail('this secrets file was already applied; use a new --secrets file for another rotation')
    if (next.oldJwtSecretHash !== createHash('sha256').update(current.jwtSecret).digest('hex')) fail('the stack no longer has the secrets this plan was made for')
  } else {
    next = generate(current)
    next.oldJwtSecretHash = createHash('sha256').update(current.jwtSecret).digest('hex')
    next.old = { anonKey: current.anonKey, dbPasswords: current.dbPasswords, jwtSecret: current.jwtSecret, serviceRoleKey: current.serviceRoleKey }
    writePrivate(secretsFile, JSON.stringify(next, null, 2))
  }
  for (const role of current.loginRoles) if (!next.rolePasswords[role]) fail(`no new password generated for role ${role}`)
  const built = buildNew(current, next)
  log(`login roles to rotate: ${current.loginRoles.join(' ')}`)
  log(`services use db users: ${Object.keys(current.dbPasswords).join(' ')}`)
  log(`ES256 keys: ${current.ecKeys.length}; Kong left unchanged (${current.sbKeys.length} demo sb_ keys there will stop working)`)
  log(`replacements: ${Object.entries(built.counts).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  if (built.leftovers.length) fail(`old secrets would remain: ${built.leftovers.join(', ')}`)
  log('no old secret remains in the new configuration')
  if (!built.counts['jwt secret'] || !built.counts['anon key'] || !built.counts['service_role key']) fail('expected replacements are missing')
  if (mode === 'plan') {
    log(`plan OK; secrets stored in ${secretsFile}`)
    process.exit(0)
  }

  // Keep everything needed to undo.
  const backupDir = path.join(workDir, `before-${stamp}`)
  mkdirSync(backupDir, { recursive: true })
  for (const key of recreated) writePrivate(path.join(backupDir, `${names[key]}.inspect.json`), JSON.stringify(current.containers[key], null, 2))
  log(`old configuration saved in ${backupDir}`)

  // 1. Database: role passwords and the JWT secret setting.
  const statements = current.loginRoles.map((role) => `ALTER ROLE "${role}" PASSWORD '${scramVerifier(next.rolePasswords[role])}';`)
  const jwtSet = psql("select coalesce(current_setting('app.settings.jwt_secret', true), '')")
  if (jwtSet) statements.push(`ALTER DATABASE postgres SET "app.settings.jwt_secret" TO '${next.jwtSecret}';`)
  psql(`BEGIN;\n${statements.join('\n')}\nCOMMIT;`)
  log(`database: ${current.loginRoles.length} role passwords changed${jwtSet ? ', app.settings.jwt_secret updated' : ''}`)

  // 2. Re-create the three services with the new secrets.
  for (const key of recreated) {
    const name = names[key]
    const oldName = `${name}-old-${stamp}`
    docker('rename', name, oldName)
    docker('stop', '-t', '20', oldName)
    docker('update', '--restart', 'no', oldName)
    await createLike(current.containers[key], name, built.env[key])
    docker('start', name)
    const ok = await waitHealthy(name)
    log(`${key}: re-created, ${ok ? 'healthy' : 'NOT HEALTHY'}`)
    if (!ok) fail(`${key} did not become healthy; run rollback`)
  }
  next.rotatedAt = new Date().toISOString()
  next.backupDir = backupDir
  next.oldContainerSuffix = `-old-${stamp}`
  writePrivate(secretsFile, JSON.stringify(next, null, 2))
  log('rotation applied')
  process.exit(0)
}

if (mode === 'app-role') {
  const next = JSON.parse(readFileSync(secretsFile, 'utf8'))
  psql(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cwi_app') THEN CREATE ROLE cwi_app; END IF;
END $$;
ALTER ROLE cwi_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS PASSWORD '${scramVerifier(next.cwiAppPassword)}';
GRANT CONNECT ON DATABASE postgres TO cwi_app;
GRANT USAGE ON SCHEMA public, extensions TO cwi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cwi_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO cwi_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO cwi_app;
GRANT EXECUTE ON FUNCTION extensions.gen_random_uuid() TO cwi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cwi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO cwi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO cwi_app;
GRANT USAGE ON SCHEMA auth TO cwi_app;
GRANT SELECT (id, email, is_sso_user, created_at) ON auth.users TO cwi_app;`)
  log('role cwi_app ready: DML on public, read of 4 auth.users columns, no DDL, no role or database creation')
  process.exit(0)
}

if (mode === 'backend-env') {
  if (!envFile) fail('--env-file is required')
  const next = JSON.parse(readFileSync(secretsFile, 'utf8'))
  const original = readFileSync(envFile, 'utf8')
  const lines = original.split(/\r?\n/)
  const set = (key, value) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`))
    if (i < 0) fail(`${key} not found in ${envFile}`)
    lines[i] = `${key}=${value}`
  }
  const dbLine = lines.find((l) => l.startsWith('DATABASE_URL='))
  const dbUrl = new URL(dbLine.slice('DATABASE_URL='.length).replace(/^"|"$/g, ''))
  dbUrl.username = 'cwi_app'
  dbUrl.password = next.cwiAppPassword
  set('DATABASE_URL', dbUrl.toString())
  const only = opt('only', 'all')
  if (only === 'all' || only === 'keys') {
    if (!next.rotatedAt) fail('keys are not rotated yet; use --only db')
    set('SUPABASE_ANON_KEY', next.anonKey)
    set('SUPABASE_SERVICE_ROLE_KEY', next.serviceRoleKey)
  }
  const backup = `${envFile}.before-${stamp}`
  copyFileSync(envFile, backup)
  try { chmodSync(backup, 0o600) } catch { /* Windows */ }
  writePrivate(envFile, lines.join(original.includes('\r\n') ? '\r\n' : '\n'))
  log(`backend env updated (${only === 'db' ? 'database user only' : 'database user and Supabase keys'}); previous copy ${backup}`)
  process.exit(0)
}

if (mode === 'rollback') {
  const next = JSON.parse(readFileSync(secretsFile, 'utf8'))
  if (!next.backupDir || !next.oldContainerSuffix) fail('nothing to roll back')
  const roles = Object.keys(next.rolePasswords)
  const statements = roles.map((role) => `ALTER ROLE "${role}" PASSWORD '${scramVerifier(next.old.dbPasswords[role] ?? 'postgres')}';`)
  if (psql("select coalesce(current_setting('app.settings.jwt_secret', true), '')")) statements.push(`ALTER DATABASE postgres SET "app.settings.jwt_secret" TO '${next.old.jwtSecret}';`)
  psql(`BEGIN;\n${statements.join('\n')}\nCOMMIT;`)
  for (const key of recreated) {
    const name = names[key]
    const oldName = `${name}${next.oldContainerSuffix}`
    try { docker('stop', '-t', '20', name); docker('rename', name, `${name}-failed-${stamp}`) } catch { /* may not exist */ }
    docker('rename', oldName, name)
    docker('update', '--restart', 'unless-stopped', name)
    docker('start', name)
    // Put it back on its original address (see createLike).
    const before = JSON.parse(readFileSync(path.join(next.backupDir, `${name}.inspect.json`), 'utf8'))
    for (const [net, ep] of Object.entries(before.NetworkSettings.Networks)) {
      const now = inspect(name).NetworkSettings.Networks[net]?.IPAddress
      if (ep.IPAddress && now !== ep.IPAddress) {
        docker('network', 'disconnect', net, name)
        docker('network', 'connect', '--ip', ep.IPAddress, ...(ep.Aliases || []).filter((a) => !before.Id.startsWith(a)).flatMap((a) => ['--alias', a]), net, name)
      }
    }
    log(`${key}: old container back, ${(await waitHealthy(name)) ? 'healthy' : 'NOT HEALTHY'}`)
  }
  log('rolled back; restore the backend env from its .before-* copy and restart the backend')
  process.exit(0)
}

if (mode === 'verify') {
  const next = JSON.parse(readFileSync(secretsFile, 'utf8'))
  const old = next.old
  const call = async (url, key) => {
    try {
      const res = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } })
      return res.status
    } catch (error) { return `error ${error.message}` }
  }
  const wrongLogin = async (key) => {
    try {
      const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
        body: JSON.stringify({ email: 'rotation-check@example.test', password: 'not-a-real-password' }),
        headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        method: 'POST',
      })
      return res.status
    } catch (error) { return `error ${error.message}` }
  }
  const results = {
    'auth settings, new anon key': await call(`${apiUrl}/auth/v1/settings`, next.anonKey),
    'auth login with a wrong password, new anon key (expect 400)': await wrongLogin(next.anonKey),
    'auth admin users, new service key': await call(`${apiUrl}/auth/v1/admin/users?per_page=1`, next.serviceRoleKey),
    'storage buckets, new service key': await call(`${apiUrl}/storage/v1/bucket`, next.serviceRoleKey),
    'storage buckets, OLD demo service key': await call(`${apiUrl}/storage/v1/bucket`, old.serviceRoleKey),
    'auth admin users, OLD demo service key': await call(`${apiUrl}/auth/v1/admin/users`, old.serviceRoleKey),
  }
  for (const sb of next.sbKeys) results[`storage buckets, OLD ${sb.old.slice(0, 10)}… key`] = await call(`${apiUrl}/storage/v1/bucket`, sb.old)
  for (const [k, v] of Object.entries(results)) log(`${k}: ${v}`)
  const loginWithDefault = (() => {
    try {
      execFileSync('docker', ['run', '--rm', '--network', `supabase_network_${project}`, '-e', 'PGPASSWORD=postgres', inspect(names.db).Config.Image, 'psql', '-h', names.db, '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], { stdio: 'ignore' })
      return 'ACCEPTED (bad)'
    } catch { return 'rejected (good)' }
  })()
  log(`login as postgres with the default password over the network: ${loginWithDefault}`)
  process.exit(0)
}

fail(`unknown mode ${mode}`)
