/**
 * mirror-dashboard: monitoring and bidirectional sync dashboard for public
 * mirrors (Gitea <-> GitHub/GitLab).
 *
 * Provides status inspection, mirror lag tracking in commits, error alerts,
 * and dry-run protected forced synchronization.
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const defaultExecFile = promisify(execFileCb)

function validMirrorTarget(remote, branch) {
  return typeof remote === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
    && typeof branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
    && !branch.includes('..') && !branch.includes('//')
    && !branch.endsWith('/') && !branch.endsWith('.')
    && branch.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'))
}

async function execGit(execFile, cwd, args, timeoutMs = 5000) {
  const exec = execFile || defaultExecFile
  try {
    const { stdout, stderr } = await exec('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    })
    return { ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() }
  } catch (err) {
    return { ok: false, error: err.message, stdout: '', stderr: String(err.stderr || '') }
  }
}

export async function getMirrorSyncStatus(args = {}, deps = {}) {
  const {
    owner = '',
    repo = '',
    branch = 'main',
    remote = 'github',
    repoDir = '',
  } = args

  if (!validMirrorTarget(remote, branch)) return { ok: false, error: 'Invalid mirror remote or branch name.' }

  const client = deps.client
  const execFile = deps.execFile || defaultExecFile

  const result = {
    ok: true,
    data: {
      status: 'not_configured', // 'in_sync' | 'behind' | 'ahead' | 'diverged' | 'error' | 'not_configured'
      lag: 0,
      branch,
      localSha: null,
      mirrorSha: null,
      mirrorRemote: remote || 'github',
      pushMirrors: [],
      pullMirror: null,
      warning: false,
      lastSync: null,
      lastError: null,
      message: '',
    },
  }

  // 1. Query Gitea API for configured push mirrors and repository mirror role
  if (client && owner && repo) {
    try {
      const pmRes = await client.listPushMirrors(owner, repo)
      if (pmRes?.ok && Array.isArray(pmRes.data) && pmRes.data.length > 0) {
        result.data.pushMirrors = pmRes.data
        const activePm = pmRes.data[0]
        result.data.lastSync = activePm.last_update || null
        if (activePm.last_error) {
          result.data.status = 'error'
          result.data.lastError = activePm.last_error
          result.data.warning = true
          result.data.message = `Gitea push mirror error: ${activePm.last_error}`
        }
      }
    } catch { /* push mirror API optional */ }

    try {
      const repoRes = await client.getRepo(owner, repo)
      if (repoRes?.ok && repoRes.data?.mirror) {
        result.data.pullMirror = {
          isMirror: true,
          originalUrl: repoRes.data.original_url || '',
        }
      }
    } catch { /* repo details optional */ }
  }

  // 2. Query local git repository if directory is provided
  if (repoDir) {
    const remotesRes = await execGit(execFile, repoDir, ['remote', '-v'], 3000)
    let matchedRemote = null
    if (remotesRes.ok && remotesRes.stdout) {
      const remotesText = remotesRes.stdout
      const lines = remotesText.split(/\r?\n/)
      for (const line of lines) {
        const parts = line.split(/\s+/)
        const rName = parts[0]
        if (rName === remote || rName === 'github' || rName === 'mirror') {
          matchedRemote = rName
          break
        }
      }
    }

    if (matchedRemote) {
      result.data.mirrorRemote = matchedRemote

      // Local branch commit
      const localRes = await execGit(execFile, repoDir, ['rev-parse', branch], 2000)
      if (localRes.ok && localRes.stdout) {
        result.data.localSha = localRes.stdout
      }

      // Remote mirror commit (first try local tracking ref, then ls-remote if missing)
      let mirrorSha = null
      const trackingRes = await execGit(execFile, repoDir, ['rev-parse', `${matchedRemote}/${branch}`], 2000)
      if (trackingRes.ok && trackingRes.stdout) {
        mirrorSha = trackingRes.stdout
      } else {
        const lsRes = await execGit(execFile, repoDir, ['ls-remote', '--heads', matchedRemote, `refs/heads/${branch}`], 4000)
        if (lsRes.ok && lsRes.stdout) {
          const firstPart = lsRes.stdout.split(/\s+/)[0]
          if (firstPart && firstPart.length >= 7) mirrorSha = firstPart
        }
      }

      if (mirrorSha) {
        result.data.mirrorSha = mirrorSha
      }

      // Calculate lag and sync relation if both SHAs are available
      if (result.data.localSha && result.data.mirrorSha) {
        const localSha = result.data.localSha
        const mSha = result.data.mirrorSha

        if (localSha === mSha) {
          result.data.status = 'in_sync'
          result.data.lag = 0
          result.data.message = `Mirror (${matchedRemote}) is in sync at commit ${localSha.slice(0, 8)}.`
        } else {
          // Check how many commits mirror is behind local
          const behindRes = await execGit(execFile, repoDir, ['rev-list', '--count', `${mSha}..${localSha}`], 3000)
          const behindCount = behindRes.ok ? Number.parseInt(behindRes.stdout, 10) : 0

          // Check how many commits local is behind mirror
          const aheadRes = await execGit(execFile, repoDir, ['rev-list', '--count', `${localSha}..${mSha}`], 3000)
          const aheadCount = aheadRes.ok ? Number.parseInt(aheadRes.stdout, 10) : 0

          if (behindCount > 0 && aheadCount === 0) {
            result.data.status = 'behind'
            result.data.lag = behindCount
            result.data.warning = behindCount > 1
            result.data.message = `Mirror (${matchedRemote}) is behind local by ${behindCount} commit(s).`
          } else if (aheadCount > 0 && behindCount === 0) {
            result.data.status = 'ahead'
            result.data.lag = 0
            result.data.message = `Mirror (${matchedRemote}) is ahead of local by ${aheadCount} commit(s).`
          } else if (behindCount > 0 && aheadCount > 0) {
            result.data.status = 'diverged'
            result.data.lag = behindCount
            result.data.warning = true
            result.data.message = `Mirror (${matchedRemote}) has diverged from local branch.`
          }
        }
      }
    }
  }

  // Fallback status if neither Gitea push mirror nor git remote was detected
  if (result.data.status === 'not_configured') {
    if (result.data.pushMirrors.length > 0) {
      result.data.status = 'in_sync'
      result.data.message = 'Gitea push mirror configured and healthy.'
    } else {
      result.data.message = 'No mirror configured (no Gitea push mirror or git mirror remote found).'
    }
  }

  return result
}

export async function triggerMirrorSync(args = {}, deps = {}) {
  const {
    owner = '',
    repo = '',
    branch = 'main',
    remote = 'github',
    repoDir = '',
    confirm = false,
  } = args

  if (!validMirrorTarget(remote, branch)) return { ok: false, error: 'Invalid mirror remote or branch name.' }

  if (confirm !== true) {
    return {
      ok: false,
      dryRun: true,
      error: 'Mirror synchronization requires confirm: true (dry-run preview).',
      plan: {
        owner,
        repo,
        branch,
        remote,
        action: 'sync',
      },
    }
  }

  const client = deps.client
  const execFile = deps.execFile || defaultExecFile

  // 1. Try Gitea push mirrors sync API
  if (client && owner && repo) {
    try {
      const pmRes = await client.syncPushMirrors(owner, repo)
      if (pmRes?.ok || pmRes?.status === 200 || pmRes?.status === 202) {
        return {
          ok: true,
          syncTriggered: true,
          method: 'gitea_push_mirrors_sync',
          message: `Triggered Gitea push mirrors synchronization for ${owner}/${repo}.`,
        }
      }
    } catch { /* continue to pull mirror or git push */ }

    try {
      const pullRes = await client.syncPullMirror(owner, repo)
      if (pullRes?.ok || pullRes?.status === 200 || pullRes?.status === 202) {
        return {
          ok: true,
          syncTriggered: true,
          method: 'gitea_pull_mirror_sync',
          message: `Triggered Gitea pull mirror synchronization for ${owner}/${repo}.`,
        }
      }
    } catch { /* continue to git push */ }
  }

  // 2. Try git remote push if repo directory is available
  if (repoDir) {
    const gitWrapper = deps.gitWrapper || deps.settings?.gitWrapper
    if (typeof gitWrapper !== 'string' || !gitWrapper.trim()) {
      return { ok: false, error: 'Local mirror push requires a configured gitWrapper.' }
    }
    // Only named remotes already present in this repository may receive a push.
    const configuredRemote = await execGit(execFile, repoDir, ['remote', 'get-url', '--', remote])
    if (!configuredRemote.ok) return { ok: false, error: 'Mirror remote is not configured in this repository.' }
    let pushRes
    try {
      await execFile(gitWrapper.trim(), ['push', '--', remote, `refs/heads/${branch}:refs/heads/${branch}`], {
        cwd: repoDir, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
      })
      pushRes = { ok: true }
    } catch (err) {
      pushRes = { ok: false, error: String(err.message || err) }
    }
    if (pushRes.ok) {
      return {
        ok: true,
        syncTriggered: true,
        method: 'git_remote_push',
        message: `Pushed ${branch} to mirror remote ${remote}.`,
      }
    }
    return {
      ok: false,
      error: `Failed to push to mirror remote ${remote}: ${pushRes.error || pushRes.stderr}`,
    }
  }

  return {
    ok: false,
    error: 'No active Gitea mirror API or git remote available to sync.',
  }
}
