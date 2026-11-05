// Static styles shipped with the plugin. Cards never download executable styling code.
export const ACTION_CARD_STYLES = `
* { box-sizing: border-box; }
body { margin: 0; padding: .5rem; background: transparent; color: var(--foreground, #222); font: 14px/1.5 system-ui, sans-serif; }
#card { max-width: 32rem; padding: 1rem; border: 1px solid var(--border, #ccc); border-radius: .75rem; background: var(--card, #fff); box-shadow: 0 1px 2px #0001; }
h3 { margin: .25rem 0; font-size: .875rem; font-weight: 600; overflow-wrap: anywhere; }
a { color: inherit; text-decoration: none; padding: .25rem; }
button { padding: .375rem .75rem; border: 1px solid var(--border, #ccc); border-radius: .5rem; background: var(--accent, #eee); color: inherit; font: inherit; font-size: .75rem; cursor: pointer; }
button:hover { opacity: .9; } button:disabled { opacity: .5; cursor: wait; }
#btn-merge, #btn-worktree, #btn-commit { background: var(--primary, #4f46e5); color: var(--primary-foreground, white); }
.flex { display: flex; } .inline-flex { display: inline-flex; } .hidden { display: none; } .block { display: block; }
.items-start { align-items: flex-start; } .items-center { align-items: center; } .justify-between { justify-content: space-between; }
.flex-wrap { flex-wrap: wrap; } .flex-1 { flex: 1; } .min-w-0 { min-width: 0; }
.gap-1 { gap: .25rem; } .gap-2 { gap: .5rem; } .gap-3 { gap: .75rem; }
.mt-2 { margin-top: .5rem; } .mt-3 { margin-top: .75rem; } .mt-4 { margin-top: 1rem; } .mb-1 { margin-bottom: .25rem; }
.pt-3 { padding-top: .75rem; } .px-2 { padding-inline: .5rem; } .py-1 { padding-block: .25rem; }
[class~="py-0.5"] { padding-block: .125rem; } [class~="px-2.5"] { padding-inline: .625rem; } [class~="py-1.5"] { padding-block: .375rem; }
.text-xs { font-size: .75rem; } .text-sm { font-size: .875rem; } .font-mono { font-family: ui-monospace, monospace; }
.font-bold { font-weight: 700; } .font-medium { font-weight: 500; }
.rounded { border-radius: .25rem; } .rounded-md { border-radius: .375rem; } .rounded-full { border-radius: 999px; }
.border { border: 1px solid var(--border, #ccc); } .border-t { border-top: 1px solid var(--border, #ccc); }
.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.text-red-500, #btn-close, #btn-conflict, #btn-ci { color: #dc2626; }
.text-emerald-500 { color: #059669; } .text-amber-500 { color: #b45309; } .text-purple-500 { color: #9333ea; } .text-zinc-400 { color: #71717a; }
[class*="bg-red-500/"] { background: #ef44441a; } [class*="bg-emerald-500/"] { background: #10b9811a; }
[class*="bg-amber-500/"] { background: #f59e0b1a; } [class*="bg-purple-500/"] { background: #a855f71a; }
`
