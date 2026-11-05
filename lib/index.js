import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GiteaClient, normalizeBaseUrl } from './gitea-client.js'
import { createGiteaTaskService } from './task-service.js'
import { createGiteaEventsService } from './gitea-events.js'
import { registerPluginUpdater } from './plugin-updater.js'

import { runHandler, formatToolResult, toLossless, LEGACY_MAP } from './handlers.js'
import { stripSecretsFromConfig, credentialRefStatus, unwrapVolatile } from './secrets.js'
import { isGitDir } from './git-local.js'
import { registerHttpRoutes, writeJson, readBody } from './routes.js'
import { EventStore } from './events-store.js'
import { BgScheduler } from './bg-scheduler.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { rememberSessionGitDirs, resolveSessionGitDir, sessionIdsFromExec, sessionCwdFromExec, repoCwdFromTool, candidateGitDirsFromExec, candidateGitDirsFromSessionJsonl, selectChipRepoDir } from './session-git.js'
import { addJob, listJobs, runJob } from './scheduler.js'

export const name = '@goodandready/dsh-gitea'
export const inject = ['tools', 'credentials', 'settings', 'webServer']

const NS = 'dsh-gitea'
const execFileAsync = promisify(execFile)

// #287: Reusable GiteaClient instance cache keyed by baseUrl#token#timeoutMs
const clientCache = new Map()

export function clearClientCache() {
  clientCache.clear()
}

export function getCachedClient({ baseUrl, token, timeoutMs }) {
  const key = `${baseUrl}#${token}#${timeoutMs}`
  let client = clientCache.get(key)
  if (!client) {
    if (clientCache.size >= 50) {
      const oldestKey = clientCache.keys().next().value
      if (oldestKey !== undefined) clientCache.delete(oldestKey)
    }
    client = new GiteaClient({ baseUrl, token, timeoutMs })
    clientCache.set(key, client)
  }
  return client
}

// Schemastery v3.18.4 natively supports .volatile()

export const Config = z.object({
  baseUrl: z.string().default('')
    .description('Gitea or Forgejo instance URL, e.g. https://gitea.example.com')
    .volatile(),
  tokenEnv: z.string().role('credential-ref').default('GITEA_TOKEN')
    .description('DSH credential name holding the API token.')
    .volatile(),
  defaultOwner: z.string().default('')
    .description('Default repository owner when the tool omits owner/repo.')
    .volatile(),
  defaultRepo: z.string().default('')
    .description('Default repository name when the tool omits owner/repo.')
    .volatile(),
  gitWrapper: z.string().default('')
    .description('Git wrapper binary (e.g. git-deepseek-harness) used for write operations. Empty disables worktree add/remove.')
    .volatile(),
  dodReminder: z.boolean().default(false)
    .description('DoD reminder: after a tool run that changed git files, remind if no issue/PR reference was made. Default off, never blocks.')
    .volatile(),
  bgSchedulerEnabled: z.boolean().default(false)
    .description('Background scheduler: periodically runs triage/health and sends digest. Default off.')
    .volatile(),
  bgSchedulerIntervalMin: z.number().default(60)
    .description('Background scheduler interval in minutes (default 60).')
    .volatile(),
  bgSchedulerOwner: z.string().default('')
    .description('Owner for background triage (default from defaultOwner).')
    .volatile(),
  bgSchedulerRepo: z.string().default('')
    .description('Repo for background triage (default from defaultRepo).')
    .volatile(),
  bgSchedulerWebhook: z.string().default('')
    .description('Optional webhook URL to deliver the digest to (external channel). Empty = only in-memory events.')
    .volatile(),
  notifyWebhook: z.string().default('')
    .description('Webhook URL for push notifications (new PR, failed CI). Empty disables push.')
    .volatile(),
  forceHttpsUrls: z.boolean().default(false)
    .description('When DSH is served over HTTPS but Gitea answers with http:// links (reverse proxy), rewrite html_url to https. Default off.')
    .volatile(),
  webhookSecretEnv: z.string().role('credential-ref').default('')
    .description('DSH credential name holding the secret for verifying X-Gitea-Signature on POST /dsh-gitea/webhook.')
    .volatile(),
  instances: z.array(z.object({
    name: z.string(),
    baseUrl: z.string(),
    tokenEnv: z.string().role('credential-ref'),
  })).default([])
    .description('Additional Gitea instances: name, baseUrl, credential name. Tools accept instance param; default is primary (baseUrl/tokenEnv).')
    .volatile(),
  timeoutMs: z.number().default(30000)
    .description('HTTP timeout in milliseconds.')
    .volatile(),
})

const GITEA_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'number' },
    title: { type: 'string' },
    name: { type: 'string' },
    merged: { type: 'boolean' },
    state: { type: 'string' },
    id: { type: 'number' },
    body: { type: 'string' },
    html_url: { type: 'string' },
    full_name: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
    user_login: { type: 'string' },
    login: { type: 'string' },
    path: { type: 'string' },
    branch: { type: 'string' },
    dirty: { type: 'boolean' },
    head: { type: 'string' },
    current: { type: 'boolean' },
    repoDir: { type: 'string' },
  },
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    error: { type: 'string' },
    data: { type: 'json' },
  },
}

import { TOOL_DEFS } from './tool-defs.js'


export { unwrapVolatile }

export function parseConfig(raw) {
  const clean = unwrapVolatile(stripSecretsFromConfig(raw ?? {}))
  const validated = Config(clean)
  return unwrapVolatile(validated)
}

async function readGitOrigin(cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd })
    return String(stdout || '').trim()
  } catch {
    return ''
  }
}

export function apply(ctx, config) {
  const getService = (c, name) => (c && typeof c.get === 'function' ? c.get(name) : (c && c[name]))

  const baseConfig = parseConfig(config)
  let dynamicConfig = () => parseConfig(config)
  let getConfig = () => dynamicConfig()
  const live = () => parseConfig(getConfig())
  // settings.register exists in neither DSH 0.1.7-rc.2 nor 0.2.0, so a scope built
  // from it never existed and getSettingsScope() always returned this in-memory
  // fallback: writes updated the live config for the process lifetime and were
  // lost on restart. Back it with the real settings service instead, whose
  // describe()/update() are the 0.2 contract and are present in both releases.
  let settingsSvc = null

  const readServedConfig = () => {
    if (typeof settingsSvc?.describe !== 'function') return null
    try {
      const row = settingsSvc.describe().find((r) => r?.ns === NS)
      if (!row || !row.value) return null
      if (row.status && row.status !== 'ready') return null
      return parseConfig(structuredClone(row.value))
    } catch (err) {
      ctx.logger?.warn?.('[dsh-gitea] settings describe failed:', err?.message || err)
      return null
    }
  }

  const servedScope = {
    get: () => getConfig(),
    update: async (patch) => {
      // #301: Transactional update: validate and persist before mutating in-memory dynamicConfig
      const prev = getConfig()
      const merged = { ...prev, ...patch }
      if (prev && ('webhookSecret' in prev) && !('webhookSecret' in patch)) {
        merged.webhookSecret = prev.webhookSecret
      }
      const next = parseConfig(merged)
      const revision = (() => {
        try {
          return settingsSvc?.describe?.().find((r) => r?.ns === NS)?.revision
        } catch {
          return undefined
        }
      })()
      if (typeof settingsSvc?.update === 'function') {
        await settingsSvc.update(NS, structuredClone(unwrapVolatile(next)), revision)
      } else if (typeof settingsSvc?.replace === 'function') {
        await settingsSvc.replace(NS, structuredClone(unwrapVolatile(next)), revision)
      }
      // Mutate in-memory config and invalidate client cache only after successful persistence
      dynamicConfig = () => next
      clearClientCache()
      return next
    },
  }

  ctx.inject(['settings'], (sctx) => {
    try {
      settingsSvc = getService(sctx, 'settings') || sctx.settings || null
      const served = readServedConfig()
      if (served) dynamicConfig = () => served
      if (typeof sctx.effect === 'function') {
        sctx.effect(() => () => {
          settingsSvc = null
          dynamicConfig = () => parseConfig(config)
          clearClientCache()
        })
      }
    } catch (err) {
      // The profile may be mounted without the settings service; the static config
      // stays authoritative and the loader/volatile-update handler below still
      // applies later changes.
      ctx.logger?.warn?.('[dsh-gitea] settings service unavailable:', err?.message || err)
    }
  })

  // Listen for volatile updates and config changes in modern DSH loaders
  if (typeof ctx?.on === 'function') {
    const applyPatch = (updated) => {
      if (updated && typeof updated === 'object') {
        const incoming = updated[NS] ?? updated
        if (incoming && typeof incoming === 'object') {
          try {
            const next = parseConfig({ ...getConfig(), ...incoming })
            dynamicConfig = () => next
          } catch { /* ignore invalid update */ }
        }
      }
    }
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => ctx.on('loader/volatile-update', applyPatch))
      ctx.effect(() => ctx.on('config', applyPatch))
      ctx.effect(() => ctx.on('settings/document-updated', applyPatch))
    } else {
      ctx.on('loader/volatile-update', applyPatch)
      ctx.on('config', applyPatch)
      ctx.on('settings/document-updated', applyPatch)
    }
  }

  // Receive Gitea webhook events (for notifications panel)
  const eventsStore = new EventStore(50)
  const giteaEventsService = createGiteaEventsService()


  ctx.effect(() => registerPluginUpdater(ctx, {
    updatesDisabled: true,
    endpoint: '/api/dsh-gitea/update',
    packageName: '@goodandready/dsh-gitea',
    manifestUrl: new URL('../package.json', import.meta.url),
  }), 'dsh-gitea: /api/dsh-gitea/update')

  async function tokenConfigured(tokenEnv) {
    const status = credentialRefStatus(tokenEnv)
    if (!status.ok) return false
    try {
      const creds = getService(ctx, 'credentials') || ctx.credentials
      if (creds && typeof creds.describe === 'function') {
        const described = await creds.describe(credentialRef(status.name))
        return !!(described && described.configured)
      }
      const resolved = await creds.resolve(credentialRef(status.name))
      return !!(resolved && resolved.value)
    } catch {
      return false
    }
  }

  registerHttpRoutes(ctx, {
    parseConfig,
    live,
    getSettingsScope: () => servedScope,
    resolveToken,
    tokenConfigured,
    eventsStore,
    giteaEventsService,
    pinGitFromSessionLog,
    execFile: execFileAsync,
  })

  async function resolveToken(tokenEnv) {
    try {
      const resolved = await ctx.credentials.resolve(credentialRef(tokenEnv))
      if (resolved?.value) return resolved.value
    } catch { /* credential may be unset */ }
    return ''
  }

  const taskService = createGiteaTaskService({
    getConfig: live,
    resolveToken,
  })
  if (typeof ctx.provide === 'function') {
    ctx.provide('dshGitea', taskService)
    ctx.provide('giteaEvents', giteaEventsService)
  }

  async function makeDeps(remoteUrl, instanceName = '') {
    const cfg = live()
    const { resolveInstance } = await import('./instances.js')
    const inst = resolveInstance(cfg, instanceName)
    if (instanceName && !inst.ok) {
      return {
        instanceError: `Instance "${instanceName}" not found in configured instances.`,
        settings: cfg,
        remoteUrl,
      }
    }
    const tokenEnv = inst.ok ? inst.tokenEnv : cfg.tokenEnv
    const baseUrl = normalizeBaseUrl(inst.ok ? inst.baseUrl : cfg.baseUrl)
    const token = await resolveToken(tokenEnv)
    const client = getCachedClient({
      baseUrl,
      token,
      timeoutMs: cfg.timeoutMs,
    })
    return {
      client,
      settings: cfg,
      remoteUrl,
      configured: { baseUrl, token },
      execFile: execFileAsync,
      logger: ctx.logger,
      gitWrapper: cfg.gitWrapper,
      eventsStore,
      giteaEventsService,
    }
  }

  for (const def of TOOL_DEFS) {
    ctx.tools.register(
      defineTool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        output: {
          schema: OUTPUT_SCHEMA,
          render: (_args, value) => formatToolResult(def.name, value),
        },
        execute: async (args, exec) => {
          const sessionCwd = sessionCwdFromExec(exec)
          const cwd = repoCwdFromTool({ args, sessionCwd })
          const remoteUrl = cwd ? await readGitOrigin(cwd) : ''
          const deps = await makeDeps(remoteUrl, args.instance)
          if (deps.instanceError) {
            return toLossless({ ok: false, error: deps.instanceError })
          }
          deps.cwd = cwd
          deps.instance = args.instance || ''
          const result = await runHandler(def.name, args, deps)
          try { await pinGitFromExec({ ...exec, arguments: args }, result) } catch { /* never break a gitea tool */ }
          // #153: normalize schemes when DSH is on HTTPS and Gitea returns HTTP links
          if (live().forceHttpsUrls && result && typeof result === 'object') {
            try {
              const { normalizeExternalUrl } = await import('./url-safety.js')
              const visit = (node) => {
                if (!node || typeof node !== 'object') return node
                for (const key of Object.keys(node)) {
                  const v = node[key]
                  if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
                    node[key] = normalizeExternalUrl(v, { baseUrl: deps.configured?.baseUrl || '', dshProtocol: 'https:' })
                  } else if (v && typeof v === 'object') {
                    visit(v)
                  }
                }
                return node
              }
              if (result.value && typeof result.value === 'object') visit(result.value)
              else visit(result)
            } catch { /* normalization must not break result */ }
          }
          return toLossless(result)
        },
      }),
    )
  }

  // #305: Register legacy tool aliases (omit 'action' from required for alias schema)
  for (const [legacyName, [canonicalName, defaultAction]] of Object.entries(LEGACY_MAP)) {
    const canonicalDef = TOOL_DEFS.find((d) => d.name === canonicalName)
    const params = canonicalDef ? JSON.parse(JSON.stringify(canonicalDef.parameters || {})) : {}
    if (Array.isArray(params.required)) {
      params.required = params.required.filter((r) => r !== 'action')
    }
    ctx.tools.register(
      defineTool({
        name: legacyName,
        description: `[Deprecated alias for ${canonicalName} action: ${defaultAction}] ${canonicalDef?.description || ''}`,
        parameters: params,
        output: {
          schema: OUTPUT_SCHEMA,
          render: (_args, value) => formatToolResult(canonicalName, value),
        },
        execute: async (args, exec) => {
          const sessionCwd = sessionCwdFromExec(exec)
          const cwd = repoCwdFromTool({ args, sessionCwd })
          const remoteUrl = cwd ? await readGitOrigin(cwd) : ''
          const deps = await makeDeps(remoteUrl, args.instance)
          if (deps.instanceError) {
            return toLossless({ ok: false, error: deps.instanceError })
          }
          deps.cwd = cwd
          deps.instance = args.instance || ''
          const effectiveArgs = { ...args, action: args.action || defaultAction }
          const result = await runHandler(legacyName, effectiveArgs, deps)
          try { await pinGitFromExec({ ...exec, arguments: effectiveArgs }, result) } catch { /* ignore */ }
          return toLossless(result)
        },
      }),
    )
  }


  async function pinFirstGitDir(ids, dirs) {
    if (!ids.length) return
    for (const dir of dirs) {
      if (await isGitDir(dir, execFileAsync)) {
        rememberSessionGitDirs(ids, dir)
        return dir
      }
    }
  }

  async function pinGitFromExec(exec, result) {
    await pinFirstGitDir(sessionIdsFromExec(exec), candidateGitDirsFromExec(exec, result))
  }

  const sessionLogInflight = new Map()
  async function pinGitFromSessionLog(sessionId) {
    const id = String(sessionId || '').trim()
    if (!id) return
    if (resolveSessionGitDir({ sessionId: id })) return
    if (sessionLogInflight.has(id)) return sessionLogInflight.get(id)
    const job = (async () => {
      const file = await findSessionLogFile(id)
      if (!file) return
      const text = await readSessionLogText(file)
      await pinFirstGitDir([id], candidateGitDirsFromSessionJsonl(text))
    })()
    sessionLogInflight.set(id, job)
    try { await job } catch { /* chip poll must never throw */ }
    finally { sessionLogInflight.delete(id) }
  }

  async function findSessionLogFile(sessionId) {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const root = path.join(home, 'sessions')
    const walk = async (dir, depth) => {
      if (depth > 4) return ''
      let entries = []
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return '' }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (!ent.isDirectory()) continue
        if (ent.name === sessionId) {
          for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
            const candidate = path.join(full, name)
            try { await fs.access(candidate); return candidate } catch { /* next name */ }
          }
        }
        const nested = await walk(full, depth + 1)
        if (nested) return nested
      }
      return ''
    }
    return walk(root, 0)
  }

  async function readSessionLogText(file) {
    if (String(file).endsWith('.zstd')) {
      try {
        const { stdout } = await execFileAsync('zstdcat', [file], { maxBuffer: 32 * 1024 * 1024 })
        return String(stdout || '')
      } catch {
        const { stdout } = await execFileAsync('zstd', ['-dc', file], { maxBuffer: 32 * 1024 * 1024 })
        return String(stdout || '')
      }
    }
    return String(await fs.readFile(file, 'utf8'))
  }

  const registerMiddleware = () => ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    try { await pinGitFromExec(exec, result) } catch { /* never break another tool */ }
    // DoD reminder (default off): if git files were modified without issue/PR ref
    if (live().dodReminder) {
      try {
        const { checkDoD } = await import('./dod-reminder.js')
        const text = JSON.stringify(exec?.arguments || {}) + ' ' + JSON.stringify(result?.value || '')
        const reminder = checkDoD({ changedGitFiles: /git|commit|push|worktree|add|rm|mv/i.test(text), references: [], text })
        if (reminder.reminder) {
          const note = { type: 'text', text: reminder.message }
          if (result && Array.isArray(result.value)) result.value.push(note)
          else if (result) result.value = [result.value, note]
        }
      } catch { /* never break another tool */ }
    }
    return result
  })
  if (typeof ctx.effect === 'function') {
    ctx.effect(registerMiddleware)
  } else {
    registerMiddleware()
  }

  // Background scheduler (default off): periodic triage/health + optional delivery
  ctx.effect(() => {
    const scheduler = new BgScheduler({ intervalMs: Math.max(1, live().bgSchedulerIntervalMin) * 60000 })
    if (live().bgSchedulerEnabled) {
      scheduler.onTick(async () => {
        const cfg = live()
        const owner = cfg.bgSchedulerOwner || cfg.defaultOwner
        const repo = cfg.bgSchedulerRepo || cfg.defaultRepo
        if (!cfg.baseUrl || !owner || !repo) return { ok: false, error: 'bg scheduler: owner/repo/baseUrl not configured' }
        const token = await resolveToken(cfg.tokenEnv)
        const client2 = new GiteaClient({ baseUrl: cfg.baseUrl, token, timeoutMs: cfg.timeoutMs })
        const { buildTriageDigest } = await import('./triage-digest.js')
        const digest = await buildTriageDigest({ owner, repo }, { client: client2 })
        if (digest?.ok && cfg.bgSchedulerWebhook) {
          const text = `[Triage Digest] ${owner}/${repo}: ${digest.data?.openIssues || 0} open issues, ${digest.data?.openPulls || 0} open PRs`
          try {
            const schedSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(10_000)
              : undefined
            await fetch(cfg.bgSchedulerWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, digest: digest.data }),
              signal: schedSignal,
            })
          } catch { /* delivery failure should not break bg scheduler */ }
        }
        try {
          const { runWorktreeGc } = await import('./worktree-gc.js')
          await runWorktreeGc({ confirm: false, dryRun: true }, {
            cwd: process.cwd(),
            execFile: ctx?.execFile,
            gitWrapper: cfg.gitWrapper,
          })
        } catch { /* ignore optional background GC inspection */ }
        return digest
      })
      scheduler.start()
    }
    return () => { scheduler.stop() }
  }, 'dsh-gitea: bg scheduler')
}
