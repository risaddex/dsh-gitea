import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Scan distributable sources and docs, excluding test fixtures and local credentials.
const patterns = [
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
]
let failed = false
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await scan(path)
    else {
      const content = await readFile(path, 'utf8')
      if (patterns.some((pattern) => pattern.test(content))) {
        // Never print matched secret values.
        failed = true
        console.error(`Possible secret in ${path}`)
      }
    }
  }
}
for (const dir of ['lib', 'assets', 'docs']) await scan(dir)
if (failed) process.exitCode = 1
else console.log('No recognizable secret material found in distributable sources and docs.')
