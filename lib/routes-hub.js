/**
 * routes-hub: request handler for Gitea Hub endpoint (/dsh-gitea/hub).
 * Manages actions (approve, merge, close, worktree, ci-analyze, stack, conflicts)
 * and aggregations (issues, pulls, runners, worktrees).
 */

import { rejectUntrustedRequest, rejectUntrustedWrite } from './http-guard.js'

export async function handleHubRequest(req, res, ctxOptions = {}) {
  const {
    cfg = {},
    options = {},
    ctx,
    execFile,
    readBody,
    writeJson,
    routeOptions,
    GiteaClient,
    resolveToken,
  } = ctxOptions

  if (req.method !== 'GET' && req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method', message: 'GET or POST' } })
    return
  }
  if (req.method === 'POST') {
    if (rejectUntrustedWrite(req, res, routeOptions())) return
  } else {
    if (rejectUntrustedRequest(req, res, routeOptions())) return
  }

  const token = await resolveToken(cfg.tokenEnv)
  if (!cfg.baseUrl || !token) {
    writeJson(res, 200, { ok: false, error: 'Gitea instance or credential not configured' })
    return
  }
  const client = options?.client || new GiteaClient({ baseUrl: cfg.baseUrl, token, timeoutMs: cfg.timeoutMs })

  if (req.method === 'POST') {
    let body = {}
    try {
      const raw = await readBody(req)
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      writeJson(res, 400, { ok: false, error: 'Invalid JSON body' })
      return
    }
    const action = String(body.action || '').toLowerCase()
    const owner = body.owner || cfg.defaultOwner || ''
    const repo = body.repo || cfg.defaultRepo || ''
    const number = Number(body.number)
    try {
      let result = null
      if (action === 'approve') {
        result = await client.submitPullReview(owner, repo, number, { event: 'APPROVED', body: 'Approved via Gitea Hub' })
      } else if (action === 'merge') {
        result = await client.mergePull(owner, repo, number, { Do: 'merge' })
      } else if (action === 'close') {
        if (body.type === 'pr') {
          result = await client.editPull(owner, repo, number, { state: 'closed' })
        } else {
          result = await client.closeIssue(owner, repo, number)
        }
      } else if (action === 'switch' || action === 'use') {
        const { runWorktreeAction } = await import('./git-local.js')
        result = await runWorktreeAction('use', { worktreePath: body.path, repoCwd: process.cwd() }, { execFile: ctx?.execFile || execFile, gitWrapper: cfg.gitWrapper })
      } else if (action === 'clean' || action === 'gc') {
        const { runWorktreeGc } = await import('./worktree-gc.js')
        result = await runWorktreeGc({ confirm: true }, { cwd: process.cwd(), execFile: ctx?.execFile || execFile, gitWrapper: cfg.gitWrapper })
      } else if (action === 'ci-analyze' || action === 'explain-ci') {
        const { runCiLogsAnalyze } = await import('./ci-explainer.js')
        result = await runCiLogsAnalyze({
          owner,
          repo,
          run_id: body.run_id || body.runId,
          job_id: body.job_id || body.jobId,
          pr_number: number || body.pr_number || body.prNumber,
        }, { client, settings: cfg })
      } else if (action === 'worktree-open' || action === 'open-worktree') {
        const targetNum = number || body.issue_number
        const branchName = body.branch || (targetNum ? `feat/issue-${targetNum}` : 'feat/patch')
        const wtPath = body.path || `.worktrees/issue-${targetNum || Date.now()}`
        const { runWorktreeAction } = await import('./git-local.js')
        result = await runWorktreeAction('add', {
          worktreePath: wtPath,
          createBranch: branchName,
          repoCwd: body.cwd || process.cwd(),
        }, { execFile: ctx?.execFile || execFile, gitWrapper: cfg.gitWrapper, settings: cfg })
        if (!result?.ok && String(result?.error || '').includes('already exists')) {
          result = await runWorktreeAction('use', {
            worktreePath: wtPath,
            repoCwd: body.cwd || process.cwd(),
          }, { execFile: ctx?.execFile || execFile, gitWrapper: cfg.gitWrapper, settings: cfg })
        }
      } else if (action === 'assign-me' || action === 'assign') {
        const whoRes = await (client.getCurrentUser ? client.getCurrentUser() : (client.getUser ? client.getUser() : Promise.resolve(null))).catch(() => null)
        const username = whoRes?.data?.login || whoRes?.data?.username || cfg.defaultOwner
        if (!username) {
          writeJson(res, 200, { ok: false, error: 'Cannot determine current username to assign' })
          return
        }
        result = await client.setIssueAssignee(owner, repo, number, username)
        if (result?.ok) {
          result.data = { ...(result.data || {}), assignee: username }
        }
      } else if (action === 'branch-commit' || action === 'commit') {
        const { runGitCommit } = await import('./git-local.js')
        result = await runGitCommit({
          cwd: body.cwd || process.cwd(),
          message: body.message || 'chore: quick commit via Gitea card',
        }, { execFile: ctx?.execFile || execFile, gitWrapper: cfg.gitWrapper, settings: cfg })
      } else if (action === 'branch-push' || action === 'push') {
        const { runGitPush } = await import('./git-local.js')
        result = await runGitPush({
          cwd: body.cwd || process.cwd(),
          branch: body.branch,
        }, { execFile: ctx?.execFile || execFile, gitWrapper: cfg.gitWrapper, settings: cfg })
      } else if (action === 'stack-status' || action === 'pr-stack') {
        const { buildPullStack } = await import('./pr-stack.js')
        const pullsRes = await client.listPulls(owner, repo, { state: 'all', limit: 50 }).catch((e) => ({ ok: false, error: String(e) }))
        if (!pullsRes?.ok) {
          writeJson(res, 200, { ok: false, error: pullsRes?.error || 'Failed to fetch PRs' })
          return
        }
        result = buildPullStack(pullsRes.data || [], number || body.pr_number)
      } else if (action === 'conflict-analyze' || action === 'conflicts') {
        const { analyzeMergeConflicts } = await import('./conflict-assistant.js')
        result = await analyzeMergeConflicts({
          owner,
          repo,
          pr_number: number || body.pr_number,
          head_branch: body.head_branch || body.headBranch || body.branch,
          base_branch: body.base_branch || body.baseBranch,
          file: body.file,
          content: body.content,
          cwd: body.cwd || process.cwd(),
        }, {
          client,
          settings: cfg,
          gitWrapper: cfg.gitWrapper,
          execFile: ctx?.execFile || execFile,
          cwd: body.cwd || process.cwd(),
        })
      } else if (action === 'conflict-resolve') {
        const { resolveMergeConflicts } = await import('./conflict-assistant.js')
        result = await resolveMergeConflicts({
          owner,
          repo,
          pr_number: number || body.pr_number,
          head_branch: body.head_branch || body.headBranch || body.branch,
          base_branch: body.base_branch || body.baseBranch,
          resolutions: body.resolutions,
          commit_message: body.commit_message || body.commitMessage,
          push: body.push !== false,
          confirm: body.confirm === true,
          cwd: body.cwd || process.cwd(),
        }, {
          client,
          settings: cfg,
          gitWrapper: cfg.gitWrapper,
          execFile: ctx?.execFile || execFile,
          cwd: body.cwd || process.cwd(),
        })
      } else if (action === 'stack-rebase') {
        const { executeStackRebase } = await import('./pr-stack.js')
        result = await executeStackRebase({
          owner,
          repo,
          pr_number: number || body.pr_number,
          target_base: body.target_base || body.targetBase,
          confirm: body.confirm !== false,
          force: Boolean(body.force),
        }, {
          client,
          settings: cfg,
          gitWrapper: cfg.gitWrapper,
          execFile: ctx?.execFile || execFile,
          cwd: body.cwd || process.cwd(),
        })
      } else if (action === 'mirror-status') {
        const { getMirrorSyncStatus } = await import('./mirror-dashboard.js')
        result = await getMirrorSyncStatus({
          owner,
          repo,
          branch: body.branch || 'main',
          remote: body.remote || 'github',
          repoDir: body.cwd || process.cwd(),
        }, { client, execFile: ctx?.execFile || execFile, settings: cfg })
      } else if (action === 'mirror-sync') {
        const { triggerMirrorSync } = await import('./mirror-dashboard.js')
        result = await triggerMirrorSync({
          owner,
          repo,
          branch: body.branch || 'main',
          remote: body.remote || 'github',
          repoDir: body.cwd || process.cwd(),
          confirm: body.confirm === true,
        }, { client, execFile: ctx?.execFile || execFile, settings: cfg })
      } else if (action === 'webhook-sandbox' || action === 'webhook-sandbox-list') {
        const { getWebhookHistory } = await import('./webhook-sandbox.js')
        result = { ok: true, data: getWebhookHistory({ limit: body.limit || 20, event: body.event }) }
      } else if (action === 'webhook-sandbox-get') {
        const { getWebhookEntry } = await import('./webhook-sandbox.js')
        const entry = getWebhookEntry(body.id)
        if (!entry) {
          writeJson(res, 404, { ok: false, error: 'Webhook event not found in sandbox buffer' })
          return
        }
        result = { ok: true, data: entry }
      } else if (action === 'webhook-replay') {
        const { replayWebhook } = await import('./webhook-sandbox.js')
        result = await replayWebhook(body.id || body.payload, {
          confirm: body.confirm === true,
          eventsStore: options?.eventsStore,
          giteaEventsService: options?.giteaEventsService,
        })
      } else if (action === 'webhook-clear') {
        if (body.confirm !== true) {
          writeJson(res, 400, { ok: false, error: 'Clearing webhook sandbox requires confirm: true.' })
          return
        }
        const { clearWebhookHistory } = await import('./webhook-sandbox.js')
        result = clearWebhookHistory()
      } else {
        writeJson(res, 400, { ok: false, error: `Unsupported hub action: ${action}` })
        return
      }
      writeJson(res, 200, { ok: result?.ok ?? true, data: result?.data ?? null })
    } catch (err) {
      writeJson(res, 200, { ok: false, error: String(err?.message || err) })
    }
    return
  }

  const url = new URL(req.url, 'http://localhost')
  const owner = url.searchParams.get('owner') || cfg.defaultOwner || ''
  const repo = url.searchParams.get('repo') || cfg.defaultRepo || ''
  const assignee = url.searchParams.get('assignee') || undefined
  let issues = []
  let pulls = []
  let runners = []
  let worktrees = []
  try {
    if (owner && repo) {
      const issueQuery = { state: 'open', limit: 20 }
      if (assignee) issueQuery.assignee = assignee
      const [issuesRes, pullsRes, runnersRes, runsRes] = await Promise.allSettled([
        client.listIssues(owner, repo, issueQuery),
        client.listPulls(owner, repo, { state: 'open', limit: 20 }),
        client.listRunners(owner, repo),
        client.listActionsRuns(owner, repo, { limit: 20 }),
      ])
      if (issuesRes.status === 'fulfilled' && issuesRes.value?.ok) {
        issues = Array.isArray(issuesRes.value.data) ? issuesRes.value.data : []
      }
      if (pullsRes.status === 'fulfilled' && pullsRes.value?.ok) {
        pulls = Array.isArray(pullsRes.value.data) ? pullsRes.value.data : []
        const runs = (runsRes.status === 'fulfilled' && runsRes.value?.ok)
          ? (runsRes.value.data?.workflow_runs || [])
          : []
        for (const p of pulls) {
          const headSha = p.head?.sha
          if (headSha) {
            const matchRun = runs.find((r) => r.head_sha === headSha)
            if (matchRun) {
              p.ciStatus = matchRun.conclusion || matchRun.status || null
              p.runId = matchRun.id || null
            }
          }
        }
      }
      if (runnersRes.status === 'fulfilled' && runnersRes.value?.ok) {
        const rawRunners = runnersRes.value.data?.runners || runnersRes.value.data
        runners = Array.isArray(rawRunners) ? rawRunners : []
      }
    }
    try {
      const { runWorktreeAction } = await import('./git-local.js')
      const wtRes = await runWorktreeAction('list', { repoCwd: process.cwd() }, { execFile: ctx?.execFile, gitWrapper: cfg.gitWrapper })
      if (wtRes?.ok && Array.isArray(wtRes.data)) {
        worktrees = wtRes.data
      }
    } catch { /* ignore worktree discovery error */ }
  } catch (err) {
    writeJson(res, 200, { ok: false, error: String(err?.message || err) })
    return
  }
  writeJson(res, 200, { ok: true, data: { owner, repo, issues, pulls, runners, worktrees } })
}
