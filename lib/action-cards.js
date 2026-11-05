import { ACTION_CARD_STYLES } from './action-card-styles.js'

/**
 * Interactive Generative UI Action Cards generator for DSH session chat.
 * Complies with DSH and Generative UI semantic tokens and loopback hub API.
 */

function scriptJson(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function renderIssueCardHtml({ number, title, state = 'open', labels = [], assignee = null, owner = '', repo = '', html_url = '' } = {}) {
  html_url = safeHttpUrl(html_url)
  const num = Number(number) || 0
  const cleanTitle = escapeHtml(title || 'Untitled Issue')
  const cleanState = escapeHtml(state.toUpperCase())
  const stateColor = state === 'closed' ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'

  const labelsHtml = (Array.isArray(labels) ? labels : [])
    .map((lbl) => {
      const name = typeof lbl === 'object' ? lbl.name : String(lbl)
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent)]/10 text-[var(--foreground)] border border-[var(--border)]">${escapeHtml(name)}</span>`
    })
    .join(' ')

  const assigneeBadge = assignee
    ? `<span class="text-xs text-[var(--muted-foreground)]">👤 ${escapeHtml(typeof assignee === 'object' ? (assignee.login || assignee.username) : assignee)}</span>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${ACTION_CARD_STYLES}</style>
</head>
<body class="bg-transparent text-[var(--foreground)] antialiased p-2">
  <div id="card" class="bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-xl p-4 shadow-sm max-w-lg transition-all">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <span class="text-xs font-bold font-mono px-2 py-0.5 rounded border ${stateColor}">${cleanState}</span>
          <span class="text-xs font-mono text-[var(--muted-foreground)]">#${num}</span>
          ${assigneeBadge}
        </div>
        <h3 class="font-semibold text-sm leading-snug line-clamp-2">${cleanTitle}</h3>
        ${labelsHtml ? `<div class="flex gap-1 mt-2 flex-wrap">${labelsHtml}</div>` : ''}
      </div>
      ${html_url ? `<a href="${escapeHtml(html_url)}" target="_blank" rel="noopener noreferrer" class="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors p-1" title="Open in Gitea">↗</a>` : ''}
    </div>

    <div id="status-bar" class="hidden mt-3 text-xs px-2.5 py-1.5 rounded-md"></div>

    <div class="flex gap-2 mt-4 pt-3 border-t border-[var(--border)] flex-wrap">
      <button onclick="sendAction('worktree-open')" id="btn-worktree" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 active:scale-95 transition-all">
        Open Worktree
      </button>
      <button onclick="sendAction('assign-me')" id="btn-assign" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--foreground)] border border-[var(--border)] active:scale-95 transition-all">
        Assign to Me
      </button>
      <button onclick="sendAction('close')" id="btn-close" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 active:scale-95 transition-all">
        Close Issue
      </button>
    </div>
  </div>

  <script>
    async function sendAction(act) {
      const statusBar = document.getElementById('status-bar');
      const btns = document.querySelectorAll('button');
      btns.forEach(b => b.disabled = true);
      statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--foreground)] block';
      statusBar.innerText = 'Processing action: ' + act + '...';

      try {
        const res = await fetch('/dsh-gitea/hub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: act, number: ${num}, type: 'issue', owner: ${scriptJson(owner)}, repo: ${scriptJson(repo)} })
        });
        const data = await res.json();
        if (data.ok) {
          statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-500 block';
          statusBar.innerText = 'Action ' + act + ' completed successfully!';
          if (act === 'close') {
            document.getElementById('btn-close').style.display = 'none';
          }
        } else {
          statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-red-500/15 text-red-500 block';
          statusBar.innerText = 'Action failed: ' + (data.error || 'Unknown error');
        }
      } catch (err) {
        statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-red-500/15 text-red-500 block';
        statusBar.innerText = 'Network error: ' + String(err.message || err);
      } finally {
        btns.forEach(b => b.disabled = false);
      }
    }
  </script>
</body>
</html>`
}

export function renderPullCardHtml({ number, title, state = 'open', ci_status = 'pending', ci_step = '', reviews = [], needs_rebase = false, mergeable = true, has_conflicts = false, owner = '', repo = '', html_url = '' } = {}) {
  html_url = safeHttpUrl(html_url)
  const num = Number(number) || 0
  const cleanTitle = escapeHtml(title || 'Untitled Pull Request')
  const cleanState = escapeHtml(state.toUpperCase())
  const stateColor = state === 'merged' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' : (state === 'closed' ? 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')

  const isCiPass = ci_status === 'success' || ci_status === 'passing'
  const isCiFail = ci_status === 'failure' || ci_status === 'error'
  const ciBadge = isCiPass
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">✓ CI: Passing</span>`
    : (isCiFail
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">✗ CI: Failed${ci_step ? ` (${escapeHtml(ci_step)})` : ''}</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">○ CI: Running</span>`)

  const reviewCount = Array.isArray(reviews) ? reviews.length : Number(reviews) || 0
  const reviewBadge = reviewCount > 0
    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent)]/15 text-[var(--foreground)] border border-[var(--border)]">${reviewCount} Approved</span>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${ACTION_CARD_STYLES}</style>
</head>
<body class="bg-transparent text-[var(--foreground)] antialiased p-2">
  <div id="card" class="bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-xl p-4 shadow-sm max-w-lg transition-all">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <span class="text-xs font-bold font-mono px-2 py-0.5 rounded border ${stateColor}">${cleanState}</span>
          <span class="text-xs font-mono text-[var(--muted-foreground)]">PR #${num}</span>
          ${ciBadge}
          ${reviewBadge}
          ${needs_rebase ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">🥞 Rebase Needed</span>' : ''}
          ${(!mergeable || has_conflicts) ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">⚔️ Conflicts</span>' : ''}
        </div>
        <h3 class="font-semibold text-sm leading-snug line-clamp-2">${cleanTitle}</h3>
      </div>
      ${html_url ? `<a href="${escapeHtml(html_url)}" target="_blank" rel="noopener noreferrer" class="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors p-1" title="Open in Gitea">↗</a>` : ''}
    </div>

    <div id="status-bar" class="hidden mt-3 text-xs px-2.5 py-1.5 rounded-md"></div>

    <div class="flex gap-2 mt-4 pt-3 border-t border-[var(--border)] flex-wrap">
      ${state === 'open' ? `
      <button onclick="sendAction('merge')" id="btn-merge" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 active:scale-95 transition-all">
        Merge PR
      </button>` : ''}
      <button onclick="sendAction('approve')" id="btn-approve" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--foreground)] border border-[var(--border)] active:scale-95 transition-all">
        Approve
      </button>
      ${(!mergeable || has_conflicts) && state === 'open' ? `
      <button onclick="sendAction('conflict-analyze')" id="btn-conflict" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 hover:bg-red-500/25 text-red-500 border border-red-500/20 active:scale-95 transition-all">
        Analyze Conflicts
      </button>` : ''}
      ${needs_rebase && state === 'open' ? `
      <button onclick="sendAction('stack-rebase')" id="btn-stack-rebase" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/20 active:scale-95 transition-all">
        Rebase Stack
      </button>` : ''}
      ${isCiFail ? `
      <button onclick="sendAction('ci-analyze')" id="btn-ci" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 active:scale-95 transition-all">
        Explain CI
      </button>` : ''}
      <button onclick="sendAction('close')" id="btn-close" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--muted-foreground)] active:scale-95 transition-all">
        Close PR
      </button>
    </div>
  </div>

  <script>
    async function sendAction(act) {
      const statusBar = document.getElementById('status-bar');
      const btns = document.querySelectorAll('button');
      btns.forEach(b => b.disabled = true);
      statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--foreground)] block';
      statusBar.innerText = 'Executing ' + act + '...';

      try {
        const res = await fetch('/dsh-gitea/hub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: act, number: ${num}, type: 'pr', owner: ${scriptJson(owner)}, repo: ${scriptJson(repo)} })
        });
        const data = await res.json();
        if (data.ok) {
          statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-500 block';
          statusBar.innerText = 'Action ' + act + ' completed successfully!';
          if (act === 'merge') {
            document.getElementById('btn-merge').style.display = 'none';
          }
        } else {
          statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-red-500/15 text-red-500 block';
          statusBar.innerText = 'Action failed: ' + (data.error || 'Unknown error');
        }
      } catch (err) {
        statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-red-500/15 text-red-500 block';
        statusBar.innerText = 'Network error: ' + String(err.message || err);
      } finally {
        btns.forEach(b => b.disabled = false);
      }
    }
  </script>
</body>
</html>`
}

export function renderBranchCardHtml({ branch = 'main', dirty = false, dirtyFiles = 0, ahead = 0, behind = 0, head = '', owner = '', repo = '', cwd = '' } = {}) {
  const cleanBranch = escapeHtml(branch || 'main')
  const cleanHead = escapeHtml(head ? head.slice(0, 7) : '')
  const statusBadge = dirty
    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">${dirtyFiles || 1} modified file(s)</span>`
    : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Clean tree</span>`

  const syncBadge = (ahead > 0 || behind > 0)
    ? `<span class="text-xs font-mono text-[var(--muted-foreground)]">↑${ahead} ↓${behind}</span>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${ACTION_CARD_STYLES}</style>
</head>
<body class="bg-transparent text-[var(--foreground)] antialiased p-2">
  <div id="card" class="bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded-xl p-4 shadow-sm max-w-lg transition-all">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <span class="text-xs font-bold font-mono px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--foreground)] border border-[var(--border)]">🌿 ${cleanBranch}</span>
          ${cleanHead ? `<span class="text-xs font-mono text-[var(--muted-foreground)]">@${cleanHead}</span>` : ''}
          ${syncBadge}
        </div>
        <div class="mt-2">${statusBadge}</div>
      </div>
    </div>

    <div id="status-bar" class="hidden mt-3 text-xs px-2.5 py-1.5 rounded-md"></div>

    <div class="flex gap-2 mt-4 pt-3 border-t border-[var(--border)] flex-wrap">
      <button onclick="sendAction('branch-commit')" id="btn-commit" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 active:scale-95 transition-all">
        Quick Commit
      </button>
      <button onclick="sendAction('branch-push')" id="btn-push" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--foreground)] border border-[var(--border)] active:scale-95 transition-all">
        Push Branch
      </button>
    </div>
  </div>

  <script>
    async function sendAction(act) {
      const statusBar = document.getElementById('status-bar');
      const btns = document.querySelectorAll('button');
      btns.forEach(b => b.disabled = true);
      statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-[var(--accent)]/15 text-[var(--foreground)] block';
      statusBar.innerText = 'Running ' + act + '...';

      try {
        const res = await fetch('/dsh-gitea/hub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: act, branch: ${scriptJson(branch)}, cwd: ${scriptJson(cwd)}, owner: ${scriptJson(owner)}, repo: ${scriptJson(repo)} })
        });
        const data = await res.json();
        if (data.ok) {
          statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-500 block';
          statusBar.innerText = 'Git action ' + act + ' executed successfully!';
        } else {
          statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-red-500/15 text-red-500 block';
          statusBar.innerText = 'Action failed: ' + (data.error || 'Unknown error');
        }
      } catch (err) {
        statusBar.className = 'mt-3 text-xs px-2.5 py-1.5 rounded-md bg-red-500/15 text-red-500 block';
        statusBar.innerText = 'Network error: ' + String(err.message || err);
      } finally {
        btns.forEach(b => b.disabled = false);
      }
    }
  </script>
</body>
</html>`
}

export function buildActionCardHtml(type, data = {}) {
  const normType = String(type || '').toLowerCase()
  if (normType === 'issue') return renderIssueCardHtml(data)
  if (normType === 'pr' || normType === 'pull') return renderPullCardHtml(data)
  if (normType === 'branch' || normType === 'git') return renderBranchCardHtml(data)
  throw new Error(`Unsupported card type: ${type}`)
}
