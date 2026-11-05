# 📦 @goodandready/dsh-gitea

> **Security fork — `0.7.39-security.1`:** based on upstream `v0.7.39`.
> Install a locally built tarball from this fork, not the upstream npm package.
> [Runbook de instalação local (Português)](docs/INSTALACAO-LOCAL.md).
> This build validates mirror targets, requires a wrapper for local mirror pushes,
> rejects replay of unauthenticated webhooks, improves secret filtering and ships
> offline card styles. Automatic npm updates are disabled. The original project
> documentation below describes additional features outside this focused review.

<div align="center">

<h3>Enterprise Gitea & Forgejo Integration Suite for DeepSeek Harness</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-gitea"><img src="https://img.shields.io/npm/v/@goodandready/dsh-gitea.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-gitea.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/All_Author_Projects-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="All Author Projects"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>If you like this plugin, please star it on GitHub</strong> — it shows me that the plugin is useful to you and motivates me to keep developing it.
      <br><br>
      🐛 <strong>If you find a bug or would like to request a feature</strong>, open a GitHub issue in any language — I will review your proposal and implement useful suggestions in a future plugin version.
    </td>
  </tr>
</table>

</div>

---

### 🌟 What's New in v0.7.6
- **One-Click Auto-Updater**: Check npm and upgrade directly in the DSH settings card.
- **Composition Services**: Exposes `dshGitea` (task provisioning) and `giteaEvents` (safe telemetry bridge for `@goodandready/dsh-pulse`).
- **Security & Hygiene**: Loopback and origin-hardened HTTP write guards (`lib/http-guard.js`), sanitized GitHub release export pipeline (`publish.sh`).
- **Performance & Caching**: Cache invalidation on git mutations and modularized `lib/tool-defs.js`.

### 🌟 What's New in v0.7.5
- **Canonical English Server & Agent Tool Outputs**: All tool responses, verification details, and error messages conform strictly to `dsh-plugin-authoring` canonical English standard.
- **Clean Package Boundaries**: Standalone issue form templates are safely organized in `assets/issue-templates/`; internal development specs (`docs/superpowers/`, `.gitea/`) are strictly excluded from npm packages.
- **Automated Compliance Quality Gate**: Permanent test coverage enforcing 0 Cyrillic characters across `lib/` and strict package file boundary audits.

## ⚡ Overview & Problem Solved

When autonomous AI coding agents perform complex multi-step development in DeepSeek Harness, they require seamless access to issue trackers, pull request review workflows, branch creation, and isolated workspace worktrees without risking repository corruption or leaking credentials into chat logs.

**`@goodandready/dsh-gitea`** bridges DeepSeek Harness to self-hosted **Gitea** and **Forgejo** instances. It equips agents with a complete suite of 20+ structured tools, registers a live **Git Status Chip** directly in the Web UI chat header, and enforces safety rails (`confirm: true` merge guards and dedicated write wrappers).

---

## 🏗️ Architecture

```mermaid
graph LR
    subgraph DSH ["DeepSeek Harness"]
        UI["Web UI Chat Header<br/>(Git Status Chip)"]
        Agent["Autonomous Agent<br/>(20+ Gitea Tools)"]
        Creds["Credentials Store<br/>(GITEA_TOKEN Ref)"]
    end

    subgraph Plugin ["dsh-gitea Plugin"]
        ChipPoller["/git-status API<br/>Branch & Diff Inspector"]
        Client["GiteaClient<br/>(REST API v1)"]
        WorktreeMgr["Worktree Manager<br/>(Isolated Task Trees)"]
    end

    subgraph Server ["Self-Hosted VCS"]
        Gitea["Gitea / Forgejo Server<br/>(Issues, PRs, Labels, Milestones)"]
        GitRepo["Git Repository<br/>(Worktrees & Remotes)"]
    end

    UI -->|Polls Status| ChipPoller
    ChipPoller -->|Reads Status| GitRepo
    Agent -->|Executes Tools| Client
    Agent -->|Manages Branches| WorktreeMgr
    WorktreeMgr -->|git worktree| GitRepo
    Client -->|Authenticated REST| Gitea
    Creds -.->|Resolves In-Memory| Client
```

---

## ✨ Full Feature Breakdown

### 1. 20+ Agent Tools Suite

All tools infer `owner` and `repo` automatically from the active workspace's `git remote get-url origin` when omitted by the agent.

| Tool Name | Scope | Description | Safety Requirements |
|:---|:---|:---|:---|
| `gitea_labels` | Labels | Consolidated label facade: `list`, `create`, `delete`, `set` | - |
| `gitea_milestones` | Milestones | Consolidated milestone facade: `list`, `create`, `update`, `delete` | ⚠️ Delete requires `confirm: true` |
| `gitea_releases` | Releases | Consolidated release facade: `list`, `create`, `update`, `delete`, `plan`, `notes` | ⚠️ Delete requires `confirm: true` |
| `gitea_ci` | CI / Actions | Consolidated CI facade: `status`, `jobs`, `rerun`, `explain` | ⚠️ Rerun requires `confirm: true` |
| `gitea_branches` | Branches | Consolidated branch facade: `list`, `create`, `delete` | ⚠️ Delete requires `confirm: true` |
| `gitea_tags` | Tags | Consolidated tag facade: `list`, `create`, `delete` | ⚠️ Delete requires `confirm: true` |
| `gitea_webhooks` | Webhooks | Consolidated webhook facade: `list`, `create`, `delete` | ⚠️ Delete requires `confirm: true` |
| `gitea_org` | Org & Teams | Consolidated organization facade: `list`, `repos`, `members`, `teams`, `create_repo` | - |
| `gitea_wiki` | Wiki | Consolidated wiki facade: `list`, `get` | - |
| `gitea_issue_create` | Issues | Creates a new issue with title, body, labels, and assignees | - |
| `gitea_issue_list` | Issues | Lists issues with state (`open`/`closed`), milestone, and label filters | - |
| `gitea_issue_get` | Issues | Fetches detailed issue data by issue index | - |
| `gitea_issue_comment`| Issues | Posts comments, progress updates, and code reviews | - |
| `gitea_issue_comments`| Issues | Lists comments for an issue (annotated with `mine: true/false`) | - |
| `gitea_issue_comment_delete`| Issues | Deletes own issue comment (safe dry-run preview by default; only current token user comments can be deleted) | ⚠️ Requires `confirm: true` |
| `gitea_issue_update` | Issues | Updates issue title, body, or status | - |
| `gitea_issue_close`  | Issues | Closes an issue | - |
| `gitea_issue_search` | Issues | Full-text issue query across the repository/instance | - |
| `gitea_issue_set_assignee` | Team | Assigns developers or agents to issues | - |
| `gitea_pr_create`    | Pull Requests | Opens PR from source branch to base branch | - |
| `gitea_pr_list`      | Pull Requests | Lists open and closed pull requests | - |
| `gitea_pr_get`       | Pull Requests | Fetches PR diff summary, reviews, and status | - |
| `gitea_pr_comment`   | Pull Requests | Adds line comments and general PR feedback | - |
| `gitea_pr_merge`     | Pull Requests | Merges PR via merge/rebase/squash | ⚠️ Requires `confirm: true` |
| `gitea_pr_rebase`    | Pull Requests | Auto-rebase PR branch on fresh main (conflicts reported) | ⚠️ Requires `confirm: true` |
| `gitea_worktree_list`| Worktrees | Lists active git worktrees and branch paths | - |
| `gitea_worktree_add` | Worktrees | Creates an isolated worktree for concurrent tasks | - |
| `gitea_worktree_use` | Worktrees | Switches session context to a worktree directory | - |
| `gitea_worktree_remove` | Worktrees | Prunes and deletes completed worktrees | ⚠️ Requires `confirm: true` |
| `gitea_issue_templates` | Issues | Lists and validates standardized Gitea YAML issue templates from `.gitea/ISSUE_TEMPLATE` | - |
| `gitea_git_graph`    | Git & Graph | Visual topological commit graph with monospace lanes, branch/tag refs, and CI statuses | - |
| `gitea_code_search` | Discovery | Server-side code search across a repo (Gitea API; prefer local codegraph/fff when cloned) | - |
| `gitea_repo_search`  | Discovery | Searches repositories across the Gitea instance | - |
| `gitea_flavor` | Discovery | Detect gitea/forgejo flavor + feature notes | - |
| `gitea_whoami`       | Auth | Returns authenticated user details and permissions | - |
| `gitea_release_assistant` | Releases | One-click SemVer validation, multilingual changelogs, test suites, and release readiness | - |
| `gitea_worktree_gc` | Worktrees | Safe background & explicit pruning of merged agent worktrees | ⚠️ Requires `confirm: true` |
| `gitea_issue_to_pr` | Pull Requests | Converts an issue and branch into an enriched Pull Request | - |
| `gitea_ai_review` | Pull Requests | Automated PR review with line comments, secret leak checks, and interactive ```suggestion blocks | - |
| `gitea_pr_line_comment` | Pull Requests | Adds line comments and interactive ```suggestion blocks for one-click commit | - |
| `gitea_task_tracker_sync` | Ecosystem | Bidirectional Task Tracker kanban bridge adhering to `dsh-drives.task-provision.v1` | - |
| `gitea_memory_brain_sync` | Ecosystem | Synchronizes and indexes long-term facts, issues, and PRs into Memory Brain | - |
| `gitea_incident_report` | Incident | Generates sanitized incident tickets with automatic secret & private key masking | - |
| `gitea_ci_logs_analyze` | CI & Actions | Root Cause Analysis (RCA) on failed Actions logs: step localization, error classification, and fix recommendations | - |
| `gitea_action_card` | Generative UI | Interactive Generative UI Action Cards in chat for issues, PRs, and git branches with instant one-click actions | - |
| `gitea_pr_stack_status` | Pull Requests | Inspects stacked PR chains, dependency depth, and cascading rebase readiness | - |
| `gitea_pr_stack_rebase` | Pull Requests | Cascading rebase of child PRs onto updated base branch with conflict abort safety | - |
| `gitea_conflict_analyze` | Git & Conflicts | In-memory 3-way merge conflict analysis with hunk categorization (imports, packages, syntax, semantic) | - |
| `gitea_pr_conflict_resolve` | Git & Conflicts | Automated & structured merge conflict resolution with unified diff preview | ⚠️ Requires `confirm: true` |
| `gitea_release_plan` | Releases | Conventional Commits SemVer analyzer & structured changelog generator | - |
| `gitea_packages_list` | Packages | Lists published packages in Gitea Package Registry (npm, PyPI, OCI, Generic) | - |
| `gitea_package_get` | Packages | Inspects package metadata, versions, and assets in Gitea Package Registry | - |
| `gitea_package_delete` | Packages | Deletes package version from Gitea Package Registry | ⚠️ Requires `confirm: true` |
| `gitea_package_config` | Packages | Generates client registry configuration (.npmrc, pip.conf, docker login) | - |
| `gitea_suggest_reviewers` | Reviews | Recommends PR reviewers from CODEOWNERS files and git blame contributor rankings | - |
| `gitea_branch_protection_get` | Security | Inspects branch protection rules, required approvals, and push restrictions | - |
| `gitea_branch_protection_set` | Security | Configures or removes branch protection rules with dry-run safety | ⚠️ Requires `confirm: true` |
| `gitea_deploy_keys` | Security | Lists, creates, or deletes repository deploy keys with read-only/write access | ⚠️ Delete requires `confirm: true` |
| `gitea_security_audit` | Security | Comprehensive repository security audit (branch protection, deploy keys, push policies) | - |
| `gitea_mirror_sync_status` | Mirror | Inspects mirror sync status, commit lag, and triggers synchronization (Gitea <-> GitHub) | ⚠️ Sync requires `confirm: true` |
| `gitea_webhook_sandbox` | Webhooks | Webhook Sandbox & Replayer: inspect raw buffered events and replay payloads locally | ⚠️ Clear requires `confirm: true` |

*(Note: Legacy individual tool names such as `gitea_label_list`, `gitea_release_now`, `gitea_ci_explain`, etc. remain 100% supported via automatic backward compatibility mapping).*

---

### 2. Per-branch PR templates

When creating a PR via issue-flow without an explicit body, the plugin fills a template by branch type: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`.

### 3. Live Git Status Chip & Topological Commit Graph

The client component injects a real-time Git Status Chip into the DSH Web UI chat header:
* **Active Repository & Branch**: Displays current branch name (e.g., `feature/issue-42-auth`).
* **Tree Cleanliness**: Color-coded badges indicating clean vs dirty working trees and modified files count.
* **Ahead/Behind Sync Badges**: Real-time sync indicator (`↑ahead`, `↓behind`) relative to upstream or `origin/<branch>`.
* **Topological Commit Graph Modal**: Monospace branch/merge lane visualization (`●`, `◆`, `│`), commit links to Gitea Web UI, branch and tag badges, and live Gitea Actions CI statuses (`CI ✓`, `CI ✗`, `CI ●`).
* **Cross-Tab Synchronization**: Efficient multi-tab coordination using `navigator.locks` leader election and `BroadcastChannel`, eliminating duplicate network polling.
* **Uncommitted Diff Inspector**: 1-click panel showing recent commits and uncommitted diff.

---

### 3. Worktree Isolation & Agent Safety Rails

To allow autonomous agents to work on multiple issues without touching the primary branch:
* **Non-destructive Worktrees**: Creates worktree paths under `.worktrees/issue-<id>/` or custom directories.
* **Confirm Guard Matrix**: Destructive operations like `gitea_pr_merge` and `gitea_worktree_remove` strictly require explicit boolean `confirm: true`. Unconfirmed tool calls are automatically rejected.
* **Git Wrapper Enforcement**: Write operations can be routed through a dedicated wrapper (`gitWrapper`, e.g., `git-deepseek-harness`) to enforce agent author signatures.

---

### 4. Gitea Issue Templates Pack

Includes standardized Gitea YAML issue templates under `.gitea/ISSUE_TEMPLATE/`:

| Template File | Purpose | Recommended Starter Labels |
|:---|:---|:---|
| `bug.yaml` | Bug report | `type/bug`, `status/ready` |
| `feature.yaml` | Feature proposal | `type/feature`, `status/ready` |
| `security.yaml` | Security vulnerability | `type/security`, `priority/high`, `scope/security` |
| `research.yaml` | Architectural research / spike | `type/research`, `status/ready` |
| `tech-debt.yaml` | Technical debt & refactoring | `type/tech-debt`, `status/ready` |
| `incident.yaml` | Production incident report | `type/incident`, `priority/critical` |
| `config-change.yaml` | Infrastructure & config change | `type/refactor`, `scope/settings`, `status/ready` |

---

### 5. Gitea Hub, CI RCA & Interactive Worktree Management

- **CI Root Cause Analysis (RCA)**: When a Gitea Actions build fails, the Hub PR card shows an **"Explain CI"** button. Clicking it runs deep semantic log parsing: identifying the exact failing step, extracting a sanitized code snippet, classifying the defect (tests, dependency, linter, syntax, build), and generating actionable remediation advice without navigating away from the workspace.
- **Autonomous Agent Worktrees**: Direct review approval, merge, close, and worktree switching buttons directly embedded in the DSH drawer.

The drawer interface includes a dedicated **Gitea Hub** backed by `/dsh-gitea/hub`:
- **Assigned Issues & PRs**: Live overview of assigned work items, status badges, and direct review/merge/close actions.
- **Worktree Management**: Instant switching between active worktree directories and safe cleaning of merged worktrees.
- **Actions Runners Inspection**: Real-time monitoring of available Gitea Actions runners and execution state.

### 6. Autonomous Agent Lifecycle & Safety Rails

- **Automated Worktree GC (`gitea_worktree_gc`)**: Background and on-demand pruning of merged branches using `git merge-base --is-ancestor`, fail-safe protections for default branch, current tree, and dirty uncommitted changes.
- **Automated AI Code Review (`gitea_ai_review`, `gitea_pr_line_comment`)**: Submits formal pull request reviews with inline diff line comments, detects secrets and path traversal hazards, and formats interactive ```suggestion blocks for one-click commit application in Gitea.
- **Issue to PR Flow (`gitea_issue_to_pr`)**: Converts issue tasks into PR branches with structured branch templates.

### 7. Ecosystem Integration & Incident Reporting

- **Task Tracker Kanban Sync (`gitea_task_tracker_sync`)**: Bidirectional synchronization with Task Tracker adhering strictly to `dsh-drives.task-provision.v1`.
- **Memory Brain Sync (`gitea_memory_brain_sync`)**: Long-term indexing of issues, PR solutions, and decisions into Memory Brain.
- **Sanitized Incident Reports (`gitea_incident_report`)**: Creates structured incident tickets with automatic sanitization of private keys (OpenSSH, EC, RSA), tokens, and sensitive headers.

### 8. Release Assistant & Real-Time Event Streaming

- **Release Assistant (`gitea_release_assistant`)**: SemVer increment validation, multi-language changelog generation, test suite verification, and preflight checks.
- **Real-Time SSE Streaming (`/dsh-gitea/sse`)**: Server-Sent Events stream with heartbeat keepalive, auto-reconnect resilience, and multi-tab broadcast deduplication.

## 📦 Installation

For this security fork, follow the [local installation runbook](docs/INSTALACAO-LOCAL.md).
After building the reviewed tarball, install it via DeepSeek Harness CLI:

```bash
dsh plugin --profile web add /absolute/path/goodandready-dsh-gitea-0.7.39-security.1.tgz --ignore-scripts
```

Restart DSH Web UI and perform a hard-refresh (`Ctrl+F5` or `Cmd+Shift+R`).

---

## ⚙️ Configuration

Navigate to **Settings -> Plugins -> Gitea**:

```yaml
# config.yaml
dsh-gitea:
  baseUrl: "https://gitea.yourcompany.com"
  tokenEnv: "GITEA_TOKEN"
  gitWrapper: ""
  timeoutMs: 15000
```

### Settings Reference Table

The plugin settings card in **Settings -> Plugins -> Gitea** organizes all 17 schema options into intuitive Core and Advanced sections:

| Key | Type | Default | Section | Description |
|:---|:---|:---|:---|:---|
| `baseUrl` | `string` | `""` | Core | Base URL of your Gitea or Forgejo instance (e.g. `https://gitea.example.com`) |
| `tokenEnv` | `string` | `"GITEA_TOKEN"` | Core | Name of the DSH Credential containing the personal access token |
| `defaultOwner` | `string` | `""` | Core | Default organization or user when tool calls omit owner |
| `defaultRepo` | `string` | `""` | Core | Default repository name when tool calls omit repo |
| `gitWrapper` | `string` | `""` | Advanced (Git) | Optional executable wrapper for write operations (e.g. `git-dsh`) |
| `dodReminder` | `boolean` | `false` | Advanced (Git) | Definition of Done reminder if a tool changes git files without referencing an issue/PR |
| `forceHttpsUrls` | `boolean` | `false` | Advanced (Git) | Rewrite `http://` links to `https://` behind an HTTPS reverse proxy |
| `timeoutMs` | `number` | `30000` | Advanced (Git) | HTTP request timeout in milliseconds (default 30000) |
| `webhookSecretEnv` | `string` | `""` | Advanced (Webhooks) | DSH Credential name holding secret to verify incoming `X-Gitea-Signature` |
| `webhookSecret` | `string` | `""` | N/A | *Deprecated*: use `webhookSecretEnv` credential ref. Kept for backwards compatibility |
| `notifyWebhook` | `string` | `""` | Advanced (Webhooks) | External webhook URL for push notifications on PR and CI failures |
| `bgSchedulerEnabled` | `boolean` | `false` | Advanced (Scheduler) | Enable background triage/health checks and digest event logging |
| `bgSchedulerIntervalMin` | `number` | `60` | Advanced (Scheduler) | Background check interval in minutes (default 60) |
| `bgSchedulerOwner` | `string` | `""` | Advanced (Scheduler) | Target owner for background triage (defaults to `defaultOwner` if empty) |
| `bgSchedulerRepo` | `string` | `""` | Advanced (Scheduler) | Target repo for background triage (defaults to `defaultRepo` if empty) |
| `bgSchedulerWebhook` | `string` | `""` | Advanced (Scheduler) | Optional webhook URL to deliver triage digests to external channel |
| `instances` | `array` | `[]` | Advanced (Instances) | Additional Gitea instances (`name`, `baseUrl`, `tokenEnv`) configured via profile |

> [!IMPORTANT]
> Never put the raw API token in the `tokenEnv` field. Store the token securely in DSH Credentials and enter only its reference key name.

---


---

## 🛡️ Route Authentication & Security Model

 exposes HTTP routes for web chip polling, commit visualization, configuration management, and interactive Hub actions. To protect against unauthorized cross-network access, drive-by CSRF, and DNS rebinding:

- **Host Connection Authentication**: All internal HTTP routes (`/dsh-gitea/config`, `/events`, `/git-status`, `/git-graph`, `/sse`, `/release-assistant`, `/hub`) delegate directly to DSH's Host Connection service (`ctx.connection.requestRejection`). External LAN/WAN requests without a valid authenticated DSH session are strictly rejected with HTTP 401 Unauthorized or 403 Forbidden.
- **Fail-Closed Loopback Isolation**: When running in standalone or test environments without the Connection service, endpoints fall back to strict local loopback gating (`127.0.0.1`, `::1`). Unauthenticated non-loopback clients are denied access.
- **Strict Write Verification**: Mutating operations (such as updating Gitea instances or hub actions) require valid same-origin headers and authenticated sessions, preventing unauthorized tampering with `baseUrl` or credential references.
- **Webhook HMAC Authentication**: Inbound webhook events (`/dsh-gitea/webhook`) are cryptographically verified using HMAC-SHA256 signatures against `webhookSecretEnv`.

## 🔒 HTTPS and mixed content

When DSH is served over HTTPS, embedded Gitea pages must also be HTTPS or the
browser blocks them (mixed content). Requirements:

- Configure Gitea behind HTTPS (or a reverse proxy) and set **Instance URL** to
  the HTTPS endpoint — then generated links are already HTTPS.
- If Gitea only answers HTTP while DSH is HTTPS, the Settings card shows a
  warning. Optionally enable **`forceHttpsUrls`** to rewrite `http://` links to
  `https://` in tool results when Gitea sits behind an HTTPS reverse proxy that
  accepts both schemes.
- Never disable the browser's mixed-content protections.

---

## 🛠️ Reliability, Webhooks & Multi-Platform Support

Added in `v0.4.3`:
- **Webhook Delivery**: `gitea_digest_delivery` and push notification dispatchers use fully-formed HTTP POST JSON requests with standard headers, ensuring delivery to Slack, Discord, Telegram, or custom webhook endpoints.
- **Cross-Platform Path Resolution**: Seamless operation across both POSIX (Linux/macOS) and Windows file systems, normalizing path separators and handling drive letters transparently.
- **Accurate Merge Analytics**: `gitea_repo_analytics` accurately detects merged pull requests matching Gitea's REST API `merged: true` specifications.
- **Branch & Path Policy Checking**: `gitea_pr_policy` reliably parses `requiredChecks` rules alongside protected branch paths from YAML configuration files.
- **Autonomous Tool Routing**: Non-repository tools (`gitea_repo_create_org`, `gitea_repo_bootstrap`, `gitea_digest_delivery`) execute cleanly without requiring an active local Git repository origin.

---

## 🧪 Testing & Verification

Run the comprehensive unit and integration test suite:

```bash
npm test
```

---

## 📄 License

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)

## Public composition service

The server half exposes an optional dshGitea composition service when the host
supports Cordis service providers. Its createIssue({ owner, repo, title, body,
labels, externalRef }) method reuses the configured Gitea URL and credential,
validates repository segments, and returns a normalized issue object with
ok, number, and url. It never starts an agent session.

externalRef is copied into a hidden body marker so cooperating plugins can
trace the issue they requested. Missing configuration and API failures are
returned as structured errors; consumers must fail closed. The canonical
consumer contract for task provisioning is
dsh-drives.task-provision.v1.

### Gitea Events Service (`giteaEvents`)

dsh-gitea exposes a producer-owned `giteaEvents` composition service for telemetry consumers (such as `@goodandready/dsh-pulse`):

```js
const stop = ctx.giteaEvents.subscribe((event) => {
  // event: { id, event, action, at, giteaContext: { owner, repo, issue, pull, project, ref } }
})
```

- **Allowlisted safe metadata**: Only public identifier fields (`id`, `event`, `action`, `at`, `owner`, `repo`, `issue`, `pull`, `ref`) are emitted.
- **Zero secrets**: Tokens, webhook secrets, request headers, raw payloads, and issue/PR comment bodies are never exposed.
- **Fault isolation**: Subscriber errors are completely isolated and never impact the webhook HTTP response or other subscribers.

### Plugin Auto-Updater

The upstream settings card provides an auto-updater powered by `/api/dsh-gitea/update`.
**This fork disables installation through that endpoint** to prevent replacing the
reviewed code with an upstream npm version. The upstream behavior is documented below:
- **Status check**: Checks npm registry for updates without SSH or command-line access.
- **Secure installation**: Accepts write requests only from local loopback origins with `x-dsh-plugin-update: 1`.
- **Safe dependencies**: Honors npm release quarantine rules.
