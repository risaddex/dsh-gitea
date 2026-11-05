import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { Readable } from 'node:stream'
import { Script, runInNewContext } from 'node:vm'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeWebhookPayload, recordWebhook, getWebhookEntry, getWebhookHistory, clearWebhookHistory, replayWebhook } from '../lib/webhook-sandbox.js'
import { triggerMirrorSync, getMirrorSyncStatus } from '../lib/mirror-dashboard.js'
import { EventStore } from '../lib/events-store.js'
import { createGiteaEventsService } from '../lib/gitea-events.js'
import { registerHttpRoutes } from '../lib/routes.js'
import { handleHubRequest } from '../lib/routes-hub.js'
import { handleRepoTool } from '../lib/handlers/repos.js'
import { computeSignature } from '../lib/webhook-signature.js'
import { buildActionCardHtml } from '../lib/action-cards.js'
import { registerPluginUpdater } from '../lib/plugin-updater.js'

beforeEach(() => clearWebhookHistory())

function response() {
  return { status: 0, body: '', writeHead(status) { this.status = status },
    end(body) { this.body = body || '' }, json() { return JSON.parse(this.body) } }
}

function request(body, headers = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  req.method = 'POST'
  req.socket = { remoteAddress: '127.0.0.1' }
  req.headers = { host: 'localhost:3000', ...headers }
  return req
}

test('redacts API keys, credentials in text, common tokens and private key formats', () => {
  const result = sanitizeWebhookPayload({
    api_key: 'fixture', apiKey: 'fixture', 'api-key': 'fixture', password: 'fixture',
    body: 'token=fixture', message: 'Authorization: fixture',
    pem: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
    rsa: '-----BEGIN RSA PRIVATE KEY-----\nfixture',
    ssh: '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture',
    pat: 'github_pat_fixture', authUrl: 'https://alice:fixture@example.com/repo',
  })
  assert(!JSON.stringify(result).includes('fixture'))
  assert.equal(sanitizeWebhookPayload({ number: 42, title: 'Ordinary title' }).title, 'Ordinary title')
})

test('depth limit drops unexamined subtrees and special keys remain inert data', () => {
  let payload = { token: 'DEEP_FIXTURE' }
  for (let i = 0; i < 12; i++) payload = { nested: payload }
  assert(!JSON.stringify(sanitizeWebhookPayload(payload)).includes('DEEP_FIXTURE'))
  const clean = sanitizeWebhookPayload(JSON.parse('{"__proto__":{"polluted":true}}'))
  assert.equal(Object.getPrototypeOf(clean), Object.prototype)
  assert.equal({}.polluted, undefined)
})

test('unverified payloads are not retained and cannot be replayed even with confirmation', async () => {
  for (const signatureStatus of ['invalid', 'unsigned', 'unconfigured']) {
    const entry = recordWebhook({ signatureStatus, payload: { body: 'UNTRUSTED_FIXTURE' } })
    assert.equal(getWebhookEntry(entry.id).payload, null)
    const result = await replayWebhook(entry.id, { confirm: true, eventsStore: new EventStore() })
    assert.equal(result.ok, false)
  }
})

test('history snapshots cannot mutate stored authentication status', () => {
  const entry = recordWebhook({ signatureStatus: 'invalid' })
  getWebhookEntry(entry.id).signatureStatus = 'valid'
  assert.equal(getWebhookEntry(entry.id).signatureStatus, 'invalid')
})

test('replay requires strict confirmation and never invokes external notification dispatcher', async () => {
  const entry = recordWebhook({ signatureStatus: 'valid', headers: { 'x-gitea-event': 'pull_request' },
    payload: { action: 'opened', pull_request: { number: 1, title: 'Fixture PR' } } })
  const eventsStore = new EventStore()
  const bus = createGiteaEventsService()
  let emitted = 0
  bus.subscribe(() => emitted++)
  const deps = { eventsStore, giteaEventsService: bus, pushNotify() { assert.fail('No external notification') } }
  for (const confirm of [undefined, false, 'true', 1]) {
    assert.equal((await replayWebhook(entry.id, { ...deps, confirm })).ok, false)
  }
  assert.equal(eventsStore.list().length, 0)
  assert.equal((await replayWebhook(entry.id, { ...deps, confirm: true })).ok, true)
  assert.equal(eventsStore.list().length, 1)
  assert.equal(emitted, 1)
})

test('synthetic replay sanitizes its payload and forwards confirmation through the tool', async () => {
  const eventsStore = new EventStore()
  const payload = { event: 'pull_request', action: 'opened', payload: { pull_request: { number: 7, title: 'token=fixture' } } }
  assert.equal((await handleRepoTool('gitea_webhook_sandbox', { action: 'replay', payload }, { eventsStore }, {})).ok, false)
  const result = await handleRepoTool('gitea_webhook_sandbox', { action: 'replay', payload, confirm: true }, { eventsStore }, {})
  assert.equal(result.ok, true)
  assert.equal(eventsStore.list()[0].title, '[REDACTED_SECRET]')
})

test('HTTP webhook preserves HMAC enforcement and retains only metadata for invalid requests', async () => {
  const routes = new Map()
  const eventsStore = new EventStore()
  const ctx = { effect: (fn) => fn(), webServer: { register(route) { routes.set(route.path, route.handler) } } }
  registerHttpRoutes(ctx, { live: () => ({ webhookSecretEnv: 'WEBHOOK_SECRET' }),
    resolveToken: async () => 'test-hmac-secret', eventsStore, giteaEventsService: createGiteaEventsService() })
  const raw = JSON.stringify({ issue: { title: 'Fixture' }, body: 'UNTRUSTED_FIXTURE' })
  const res = response()
  await routes.get('/dsh-gitea/webhook')(request(raw, { 'x-gitea-event': 'issues', 'x-gitea-signature': 'invalid' }), res)
  assert.equal(res.status, 401)
  assert.equal(eventsStore.list().length, 0)
  assert.equal(getWebhookEntry(getWebhookHistory()[0].id).payload, null)
  const valid = response()
  await routes.get('/dsh-gitea/webhook')(request(raw, { 'x-gitea-event': 'issues', 'x-gitea-signature': computeSignature('test-hmac-secret', raw) }), valid)
  assert.equal(valid.status, 200)
  assert.equal(eventsStore.list().length, 1)
})

test('mirror targets reject option injection, URLs and refspecs before any execution or API call', async () => {
  const deps = { execFile() { assert.fail('Must not execute') }, client: { syncPushMirrors() { assert.fail('Must not call API') } } }
  for (const args of [
    { remote: '--receive-pack=fixture' }, { remote: 'https://example.com/repo' },
    { branch: '--all' }, { branch: 'main:other' }, { branch: 'a..b' },
    { branch: 'a/.hidden' }, { branch: 'a.lock' }, { branch: 'a//b' },
  ]) {
    assert.equal((await triggerMirrorSync({ ...args, repoDir: '/tmp/fixture', owner: 'o', repo: 'r', confirm: true }, deps)).ok, false)
    assert.equal((await getMirrorSyncStatus(args, deps)).ok, false)
  }
})

test('mirror push requires confirmation, a wrapper and an existing named remote', async () => {
  const calls = []
  const execFile = async (bin, args) => { calls.push({ bin, args }); return { stdout: 'https://example.com/fixture.git' } }
  assert.equal((await triggerMirrorSync({ repoDir: '/tmp/fixture' }, { execFile })).ok, false)
  assert.equal((await triggerMirrorSync({ repoDir: '/tmp/fixture', confirm: true }, { execFile })).ok, false)
  assert.equal(calls.length, 0)
  const result = await triggerMirrorSync({ repoDir: '/tmp/fixture', branch: 'feature/fix', confirm: true }, { execFile, settings: { gitWrapper: '/fixture/wrapper' } })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [
    { bin: 'git', args: ['remote', 'get-url', '--', 'github'] },
    { bin: '/fixture/wrapper', args: ['push', '--', 'github', 'refs/heads/feature/fix:refs/heads/feature/fix'] },
  ])
  assert.equal((await triggerMirrorSync({ repoDir: '/tmp/fixture', confirm: true }, {
    gitWrapper: 'wrapper', execFile: async () => { throw new Error('unknown remote') },
  })).ok, false)
})

test('confirmed API mirror sync still works without a local wrapper', async () => {
  const result = await triggerMirrorSync({ owner: 'o', repo: 'r', confirm: true }, {
    client: { syncPushMirrors: async () => ({ ok: true }) },
    execFile() { assert.fail('No local git needed') },
  })
  assert.equal(result.method, 'gitea_push_mirrors_sync')
})

test('real Git uses the wrapper and pushes only the explicit branch to a local test remote', async () => {
  const exec = promisify(execFileCb)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mirror-test-'))
  try {
    const source = join(dir, 'source'), target = join(dir, 'target.git')
    await exec('git', ['init', '--initial-branch=main', source])
    await exec('git', ['init', '--bare', target])
    await exec('git', ['-C', source, '-c', 'user.name=Security Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'])
    await exec('git', ['-C', source, 'remote', 'add', 'github', target])
    const result = await triggerMirrorSync({ repoDir: source, confirm: true }, { execFile: exec, gitWrapper: 'git' })
    assert.equal(result.ok, true)
    const { stdout } = await exec('git', ['--git-dir', target, 'rev-parse', 'refs/heads/main'])
    assert.match(stdout.trim(), /^[a-f0-9]{40}$/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('hub enforces confirmation for clear/replay and preserves write authentication', async () => {
  const { readBody, writeJson } = await import('../lib/routes.js')
  const cfg = { baseUrl: 'https://example.invalid', tokenEnv: 'GITEA_TOKEN' }
  const opts = { cfg, readBody, writeJson, routeOptions: () => ({}), resolveToken: async () => 'fixture', options: { client: {} } }
  recordWebhook({ signatureStatus: 'valid' })
  const clear = response()
  await handleHubRequest(request({ action: 'webhook-clear' }), clear, opts)
  assert.equal(clear.status, 400)
  assert.equal(getWebhookHistory().length, 1)
  const replay = response()
  await handleHubRequest(request({ action: 'webhook-replay', payload: { event: 'issues' } }), replay, opts)
  assert.equal(replay.json().ok, false)
  const remote = request({ action: 'webhook-clear', confirm: true })
  remote.socket.remoteAddress = '203.0.113.5'
  const denied = response()
  await handleHubRequest(remote, denied, opts)
  assert.equal(denied.status, 403)
  const accepted = response()
  await handleHubRequest(request({ action: 'webhook-clear', confirm: true }), accepted, opts)
  assert.equal(getWebhookHistory().length, 0)
})

test('hub forwards the configured wrapper to mirror synchronization', async () => {
  const { readBody, writeJson } = await import('../lib/routes.js')
  const calls = []
  const res = response()
  await handleHubRequest(request({ action: 'mirror-sync', cwd: '/tmp/fixture', confirm: true }), res, {
    cfg: { baseUrl: 'https://example.invalid', tokenEnv: 'GITEA_TOKEN', gitWrapper: '/fixture/wrapper' },
    readBody, writeJson, routeOptions: () => ({}), resolveToken: async () => 'fixture',
    options: { client: {} },
    execFile: async (bin, args) => { calls.push({ bin, args }); return { stdout: '/fixture/remote' } },
  })
  assert.equal(res.json().ok, true)
  assert.equal(calls[1].bin, '/fixture/wrapper')
})

test('cards ship offline styles and safe links, and embedded scripts round-trip untrusted text', async () => {
  const fixture = "C:\\workspace\\O'Reilly\\</script><script>bad()</script>\u2028"
  for (const type of ['issue', 'pr', 'branch']) {
    const html = buildActionCardHtml(type, { number: 1, owner: fixture, repo: fixture, branch: fixture, cwd: fixture, title: '<img src=x onerror=bad()>', html_url: 'javascript:bad()' })
    assert(!/<script\s+src=/i.test(html))
    assert(html.includes('<style>'))
    assert(!html.includes('href="javascript:'))
    assert(!html.includes('<img src=x'))
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    assert.equal(scripts.length, 1)
    new Script(scripts[0][1])
    const context = { document: { getElementById: () => ({}), querySelectorAll: () => [] },
      fetch: async (_url, options) => { context.sent = JSON.parse(options.body); return { json: async () => ({ ok: false }) } } }
    runInNewContext(scripts[0][1], context)
    await context.sendAction('test')
    assert.equal(context.sent.owner, fixture)
    if (type === 'branch') assert.equal(context.sent.cwd, fixture)
  }
})

test('security build updater rejects installation and reports no automatic update', async () => {
  let route
  registerPluginUpdater({ webServer: { register(r) { route = r } } }, {
    endpoint: '/api/dsh-gitea/update', updatesDisabled: true,
    packageName: '@goodandready/dsh-gitea', manifestUrl: new URL('../package.json', import.meta.url),
  })
  const status = response()
  await route.handler({ method: 'GET' }, status)
  assert.equal(status.json().canAutoUpdate, false)
  assert.equal(status.json().currentVersion, '0.7.39-security.1')
  const post = response()
  await route.handler({ method: 'POST' }, post)
  assert.equal(post.status, 403)
  assert.match(await readFile(new URL('../lib/index.js', import.meta.url), 'utf8'), /updatesDisabled: true/)
})
