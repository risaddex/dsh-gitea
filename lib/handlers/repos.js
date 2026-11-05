import { wrap, pickQuery, asNumber, schedulerStore } from './common.js'

const REPO_TOOLS = new Set([
  'gitea_branches',
  'gitea_tags',
  'gitea_webhooks',
  'gitea_org',
  'gitea_wiki',
  'gitea_project_health',
  'gitea_triage_digest',
  'gitea_duty_report',
  'gitea_scheduled_checks',
  'gitea_repo_bootstrap',
  'gitea_repo_analytics',
  'gitea_mirror_public',
  'gitea_repo_search',
  'gitea_code_search',
  'gitea_repo_contents',
  'gitea_repo_commits',
  'gitea_repo_compare',
  'gitea_notifications',
  'gitea_notifications_mark_read',
  'gitea_user_search',
  'gitea_whoami',
  'gitea_flavor',
  'gitea_branch_protection_get',
  'gitea_branch_protection_set',
  'gitea_deploy_keys',
  'gitea_security_audit',
  'gitea_mirror_sync_status',
  'gitea_webhook_sandbox',
])

export function isRepoTool(name) {
  return REPO_TOOLS.has(name)
}

export async function handleRepoTool(name, args, deps, ctx) {
  const { client, owner, repo } = ctx

  if (name === 'gitea_whoami') {
    return wrap(await client.getUser())
  }

  if (name === 'gitea_flavor') {
    const { detectFlavor } = await import('../forgejo-detect.js')
    return detectFlavor({}, { client })
  }

  switch (name) {
    case 'gitea_branches': {
      const action = args.action || 'list'
      if (action === 'list') {
        return wrap(await client.listBranches(owner, repo, pickQuery(args, ['limit', 'page'])))
      }
      if (action === 'create') {
        const newBranch = args.new_branch_name || args.branch_name || args.name
        if (!newBranch) return { ok: false, error: 'branch_name (or new_branch_name) is required' }
        const oldRef = args.old_ref_name || args.ref || 'main'
        return wrap(await client.createBranch(owner, repo, { new_branch_name: newBranch, old_ref_name: oldRef }))
      }
      if (action === 'delete') {
        if (args.confirm !== true) return { ok: false, error: 'Deleting a branch requires confirm: true (boolean).' }
        return wrap(await client.deleteBranch(owner, repo, args.branch))
      }
      return { ok: false, error: `unknown action: ${action}` }
    }

    case 'gitea_tags': {
      const action = args.action || 'list'
      if (action === 'list') {
        return wrap(await client.listTags(owner, repo, pickQuery(args, ['limit', 'page'])))
      }
      if (action === 'create') {
        return wrap(await client.createTag(owner, repo, { tag_name: args.tag_name, target: args.target || 'main' }))
      }
      if (action === 'delete') {
        if (args.confirm !== true) return { ok: false, error: 'Deleting a tag requires confirm: true (boolean).' }
        return wrap(await client.deleteTag(owner, repo, args.tag))
      }
      return { ok: false, error: `unknown action: ${action}` }
    }

    case 'gitea_webhooks': {
      const action = args.action || 'list'
      if (action === 'list') {
        return wrap(await client.listWebhooks(owner, repo))
      }
      if (action === 'create') {
        return wrap(await client.createWebhook(owner, repo, { type: args.type || 'gitea', config: { url: args.url }, events: args.events }))
      }
      if (action === 'delete') {
        if (args.confirm !== true) return { ok: false, error: 'Deleting a webhook requires confirm: true (boolean).' }
        return wrap(await client.deleteWebhook(owner, repo, asNumber(args.hook_id)))
      }
      return { ok: false, error: `unknown action: ${action}` }
    }

    case 'gitea_org': {
      const action = args.action || 'list'
      if (action === 'list') {
        return wrap(await client.listUserOrgs())
      }
      if (action === 'repos') {
        return wrap(await client.listOrgRepos(args.org, pickQuery(args, ['limit', 'page'])))
      }
      if (action === 'members') {
        return wrap(await client.listOrgMembers(args.org, pickQuery(args, ['limit', 'page'])))
      }
      if (action === 'teams') {
        return wrap(await client.listOrgTeams(args.org))
      }
      if (action === 'create_repo') {
        if (args.confirm !== true) {
          return {
            ok: true,
            data: {
              dryRun: true,
              action: 'create_repo',
              org: args.org,
              name: args.name,
              description: args.description,
              private: args.private !== false,
              note: 'Dry-run plan. To create organization repository, pass confirm: true.',
            },
          }
        }
        return wrap(await client.createOrgRepo(args.org, { name: args.name, description: args.description, private: args.private !== false }))
      }
      return { ok: false, error: `unknown action: ${action}` }
    }

    case 'gitea_wiki': {
      const action = args.action || 'list'
      if (action === 'list') {
        return wrap(await client.listWikiPages(owner, repo, pickQuery(args, ['limit', 'page'])))
      }
      if (action === 'get') {
        return wrap(await client.getWikiPage(owner, repo, args.pageName))
      }
      return { ok: false, error: `unknown action: ${action}` }
    }

    case 'gitea_code_search': {
      const q = args.q
      if (!q) return { ok: false, error: 'Query "q" is required for code search.' }
      const cwd = args.cwd || deps.cwd
      if (cwd && typeof deps.execFile === 'function') {
        try {
          const runExec = (cmd, gitArgs, opts) => {
            return new Promise((resolve, reject) => {
              let settled = false
              const finish = (err, val) => {
                if (settled) return
                settled = true
                if (err) reject(err)
                else resolve(val)
              }
              const cb = (err, stdout, stderr) => {
                if (err) {
                  err.stdout = stdout
                  err.stderr = stderr
                  finish(err)
                } else {
                  finish(null, { stdout, stderr })
                }
              }
              try {
                const res = deps.execFile(cmd, gitArgs, opts, cb)
                if (res && typeof res.then === 'function') {
                  res.then((val) => finish(null, val), (err) => finish(err))
                }
              } catch (err) {
                finish(err)
              }
            })
          }
          const limit = Math.min(Number(args.limit) || 20, 100)
          const gitArgs = ['grep', '-n', '-I', `--max-count=${limit}`, '-e', q]
          if (args.branch) {
            gitArgs.push(args.branch, '--')
          }
          const execRes = await runExec('git', gitArgs, { cwd, maxBuffer: 1024 * 1024 })
          const stdout = (execRes && typeof execRes === 'object' && 'stdout' in execRes) ? execRes.stdout : String(execRes || '')
          const lines = (stdout || '').split('\n').filter(Boolean)
          const matches = lines.map((line) => {
            const parts = line.split(':')
            if (parts.length >= 3) {
              return { path: parts[0], line: Number(parts[1]) || 0, text: parts.slice(2).join(':') }
            }
            return { raw: line }
          })
          return wrap({ ok: true, data: matches })
        } catch (err) {
          if (err && (err.code === 1 || err.code === '1')) {
            return wrap({ ok: true, data: [] })
          }
          return {
            ok: false,
            error: `Local git grep failed in ${cwd}: ${err.message}. Note: Gitea REST API does not provide a remote code search endpoint.`,
          }
        }
      }
      if (client.searchCode) {
        const res = await client.searchCode(owner, repo, pickQuery(args, ['q', 'branch', 'limit']))
        if (!res.ok) {
          return {
            ok: false,
            error: `Gitea REST API does not provide a remote code search endpoint (HTTP ${res.status || 'unknown'}: ${res.error || 'Not Found'}). Run gitea_code_search from an active git worktree/cwd to search locally via git grep.`,
          }
        }
        return wrap(res)
      }
      return {
        ok: false,
        error: 'Gitea REST API does not provide a remote code search endpoint (see issue #292). Run gitea_code_search from an active git worktree/cwd to search locally via git grep.',
      }
    }

    case 'gitea_repo_search':
      return wrap(await client.searchRepos(pickQuery(args, ['q', 'limit'])))
    case 'gitea_repo_contents':
      return wrap(await client.getContents(owner, repo, args.path, pickQuery(args, ['ref'])))
    case 'gitea_repo_commits':
      return wrap(await client.listCommits(owner, repo, pickQuery(args, ['sha', 'limit', 'page'])))
    case 'gitea_repo_compare':
      return wrap(await client.compareCommits(owner, repo, args.range))
    case 'gitea_notifications':
      return wrap(await client.listNotifications(pickQuery(args, ['status', 'limit', 'page'])))
    case 'gitea_notifications_mark_read': {
      if (args.confirm !== true) {
        return { ok: false, error: 'Marking notifications read requires confirm: true (boolean).' }
      }
      return wrap(await client.markNotificationsRead())
    }
    case 'gitea_user_search':
      return wrap(await client.searchUsers(pickQuery(args, ['q', 'limit'])))
    case 'gitea_project_health': {
      const { buildHealthReport } = await import('../project-health.js')
      return buildHealthReport({ owner, repo, staleDays: args.staleDays }, { client })
    }
    case 'gitea_triage_digest': {
      const { buildTriageDigest } = await import('../triage-digest.js')
      return buildTriageDigest({ owner, repo, staleDays: args.staleDays }, { client })
    }
    case 'gitea_repo_analytics': {
      const { buildAnalytics } = await import('../analytics.js')
      return buildAnalytics({ owner, repo }, { client })
    }
    case 'gitea_mirror_public': {
      const { prepareMirror } = await import('../mirror-public.js')
      return prepareMirror({ source: args.source, target: args.target }, {})
    }
    case 'gitea_repo_bootstrap': {
      const { planBootstrap, applyBootstrap } = await import('../repo-bootstrap.js')
      if (args.apply === true) return applyBootstrap({ name: args.name, description: args.description, private: args.private }, { client })
      return planBootstrap({ name: args.name, description: args.description, private: args.private })
    }
    case 'gitea_duty_report': {
      const { buildDutyReport } = await import('../duty-officer.js')
      return buildDutyReport({ owner, repo, lastCheckAt: args.lastCheckAt, staleDays: args.staleDays }, { client })
    }
    case 'gitea_scheduled_checks': {
      const { addJob, listJobs, runJob } = await import('../scheduler.js')
      if (args.action === 'list') {
        return { ok: true, data: { jobs: listJobs(schedulerStore) } }
      }
      if (args.action === 'add') {
        const r = addJob(schedulerStore, { name: args.name, schedule: args.schedule, owner, repo, action: args.checkType || 'health', dryRun: args.dryRun !== false })
        return r
      }
      if (args.action === 'run') {
        const job = schedulerStore.jobs.get(String(args.name || ''))
        if (!job) return { ok: false, error: `job not found: ${args.name}` }
        const executor = job.action === 'triage'
          ? async () => (await import('../triage-digest.js')).buildTriageDigest({ owner: job.owner, repo: job.repo }, { client })
          : job.action === 'inbox'
            ? async () => (await import('../review-inbox.js')).buildReviewInbox({ owner: job.owner, repo: job.repo, user: '' }, { client })
            : async () => (await import('../project-health.js')).buildHealthReport({ owner: job.owner, repo: job.repo }, { client })
        return runJob(job, executor)
      }
      return { ok: false, error: `unknown action: ${args.action}` }
    }
    case 'gitea_branch_protection_get': {
      const { getBranchProtectionRule } = await import('../branch-protection.js')
      return getBranchProtectionRule({ ...args, owner: args.owner || owner, repo: args.repo || repo }, { ...deps, client })
    }
    case 'gitea_branch_protection_set': {
      const { setBranchProtectionRule } = await import('../branch-protection.js')
      return setBranchProtectionRule({ ...args, owner: args.owner || owner, repo: args.repo || repo }, { ...deps, client })
    }
    case 'gitea_deploy_keys': {
      const { listDeployKeys, addDeployKey, deleteDeployKey } = await import('../branch-protection.js')
      const action = args.action || 'list'
      if (action === 'list') return listDeployKeys({ ...args, owner: args.owner || owner, repo: args.repo || repo }, { ...deps, client })
      if (action === 'add') return addDeployKey({ ...args, owner: args.owner || owner, repo: args.repo || repo }, { ...deps, client })
      if (action === 'delete') return deleteDeployKey({ ...args, owner: args.owner || owner, repo: args.repo || repo }, { ...deps, client })
      return { ok: false, error: `unknown deploy key action: ${action}` }
    }
    case 'gitea_security_audit': {
      const { auditBranchSecurity } = await import('../branch-protection.js')
      return auditBranchSecurity({ ...args, owner: args.owner || owner, repo: args.repo || repo }, { ...deps, client })
    }
    case 'gitea_mirror_sync_status': {
      const { getMirrorSyncStatus, triggerMirrorSync } = await import('../mirror-dashboard.js')
      const action = args.action || 'status'
      if (action === 'sync') {
        return triggerMirrorSync({ ...args, owner: args.owner || owner, repo: args.repo || repo, repoDir: args.repoDir || args.path || deps.cwd || '' }, { ...deps, client })
      }
      return getMirrorSyncStatus({ ...args, owner: args.owner || owner, repo: args.repo || repo, repoDir: args.repoDir || args.path || deps.cwd || '' }, { ...deps, client })
    }
    case 'gitea_webhook_sandbox': {
      const { getWebhookHistory, getWebhookEntry, replayWebhook, clearWebhookHistory } = await import('../webhook-sandbox.js')
      const action = args.action || 'list'
      if (action === 'list') {
        return { ok: true, data: { entries: getWebhookHistory(args) } }
      }
      if (action === 'get') {
        const entry = getWebhookEntry(args.id)
        if (!entry) return { ok: false, error: `Webhook event '${args.id}' not found in sandbox.` }
        return { ok: true, data: entry }
      }
      if (action === 'replay') {
        return replayWebhook(args.id || args.payload, {
          confirm: args.confirm === true,
          eventsStore: deps.eventsStore,
          giteaEventsService: deps.giteaEventsService,
        })
      }
      if (action === 'clear') {
        if (args.confirm !== true) return { ok: false, error: 'Clearing webhook sandbox buffer requires confirm: true.' }
        return clearWebhookHistory()
      }
      return { ok: false, error: `unknown webhook sandbox action: ${action}` }
    }
    default:
      return { ok: false, error: `Unknown repo tool: ${name}` }
  }
}
