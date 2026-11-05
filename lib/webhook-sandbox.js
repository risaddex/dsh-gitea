/**
 * webhook-sandbox: in-memory ring buffer and replayer for incoming Gitea/GitHub
 * webhooks. Allows inspecting payloads, validation statuses, and replaying events
 * through the pipeline without contacting external servers.
 */

export const MAX_SANDBOX_ENTRIES = 20

// Internal in-memory ring buffer (capped at 20 items)
const _ringBuffer = []

export function sanitizeWebhookPayload(obj, depth = 0) {
  if (depth > 10) return '[REDACTED_DEPTH_LIMIT]'
  if (obj == null) return obj
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      if (/\b(?:bearer|token)\s+[a-zA-Z0-9_.-]{8,}/i.test(obj)
        || /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(obj)
        || /\b(?:token|secret|password|api[_-]?key|authorization|credential)\s*[=:]\s*\S+/i.test(obj)
        || /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,})\b/.test(obj)
        || /https?:\/\/[^\s/]+:[^\s/]+@/i.test(obj)) {
        return '[REDACTED_SECRET]'
      }
    }
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeWebhookPayload(item, depth + 1))
  }
  const clean = {}
  for (const [k, v] of Object.entries(obj)) {
    // defineProperty preserves data keys without invoking Object.prototype setters.
    Object.defineProperty(clean, k, { enumerable: true, configurable: true, writable: true,
      value: /token|secret|password|credential|authorization|cookie|private[_-]?key|api[_-]?key/i.test(k)
        ? '[REDACTED]' : sanitizeWebhookPayload(v, depth + 1) })
  }
  return clean
}

export function filterWebhookHeaders(headers = {}) {
  const allowed = [
    'content-type',
    'user-agent',
    'x-gitea-event',
    'x-gitea-delivery',
    'x-gitea-signature',
    'x-github-event',
    'x-github-delivery',
    'x-hub-signature-256',
  ]
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase()
    if (allowed.includes(lk)) {
      if (lk.includes('signature')) {
        out[lk] = v ? '[PRESENT_HMAC_SHA256]' : '[MISSING]'
      } else {
        out[lk] = v
      }
    }
  }
  return out
}

export function recordWebhook({
  headers = {},
  rawBody = '',
  payload = null,
  signatureStatus = 'unsigned',
  sourceIp = null,
} = {}) {
  const id = 'whk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
  const event = String(headers['x-gitea-event'] || headers['x-github-event'] || 'unknown')
  const action = String(payload?.action || '')

  let byteSize = 0
  if (typeof rawBody === 'string') {
    byteSize = Buffer.byteLength(rawBody, 'utf8')
  } else if (rawBody && typeof rawBody.length === 'number') {
    byteSize = rawBody.length
  }

  const entry = {
    id,
    receivedAt: new Date().toISOString(),
    event,
    action,
    signatureStatus, // 'valid' | 'invalid' | 'unsigned' | 'unconfigured'
    sourceIp: sourceIp || null,
    headers: filterWebhookHeaders(headers),
    // Failed authentication retains diagnostic metadata only, never attacker payloads.
    payload: signatureStatus === 'valid' ? sanitizeWebhookPayload(payload || {}) : null,
    rawSize: byteSize,
  }

  _ringBuffer.unshift(entry)
  if (_ringBuffer.length > MAX_SANDBOX_ENTRIES) {
    _ringBuffer.length = MAX_SANDBOX_ENTRIES
  }

  return entry
}

export function getWebhookHistory(query = {}) {
  const limit = Math.min(Number(query.limit) || MAX_SANDBOX_ENTRIES, MAX_SANDBOX_ENTRIES)
  let list = _ringBuffer
  if (query.event) {
    list = list.filter((e) => e.event === query.event)
  }
  return list.slice(0, limit).map((e) => ({
    id: e.id,
    receivedAt: e.receivedAt,
    event: e.event,
    action: e.action,
    signatureStatus: e.signatureStatus,
    sourceIp: e.sourceIp,
    rawSize: e.rawSize,
  }))
}

export function getWebhookEntry(id) {
  const entry = _ringBuffer.find((e) => e.id === id)
  return entry ? structuredClone(entry) : null
}

export function clearWebhookHistory() {
  const cleared = _ringBuffer.length
  _ringBuffer.length = 0
  return { ok: true, cleared }
}

export async function replayWebhook(idOrPayload, deps = {}) {
  if (deps.confirm !== true) return { ok: false, error: 'Webhook replay requires confirm: true.' }
  let eventObj = null
  let entryId = null

  if (typeof idOrPayload === 'string') {
    const found = getWebhookEntry(idOrPayload)
    if (!found) {
      return { ok: false, error: `Webhook event '${idOrPayload}' not found in sandbox buffer.` }
    }
    if (found.signatureStatus !== 'valid') {
      return { ok: false, error: 'Rejected or unverified webhooks cannot be replayed.' }
    }
    entryId = found.id
    eventObj = { event: found.event, action: found.action, payload: found.payload }
  } else if (idOrPayload && typeof idOrPayload === 'object') {
    eventObj = sanitizeWebhookPayload(idOrPayload)
    entryId = idOrPayload.id || null
  } else {
    return { ok: false, error: 'Replay target must be a valid webhook ID or payload object.' }
  }

  const { event = 'unknown', action = '', payload = {} } = eventObj
  let normalizedEvent = null

  if (deps.eventsStore && typeof deps.eventsStore.fromWebhook === 'function') {
    normalizedEvent = deps.eventsStore.fromWebhook({ event, action, payload })
    if (typeof deps.eventsStore.push === 'function' && normalizedEvent) {
      deps.eventsStore.push(normalizedEvent)
    }
  }

  if (deps.giteaEventsService && typeof deps.giteaEventsService.emit === 'function') {
    try {
      deps.giteaEventsService.emit({ event, action, payload, ev: normalizedEvent })
    } catch { /* isolated */ }
  }

  // Replays never dispatch external push notifications. Subscribers receive metadata.

  return {
    ok: true,
    replayed: true,
    sourceId: entryId,
    eventId: normalizedEvent?.id || null,
    eventType: normalizedEvent?.type || event,
    event: normalizedEvent,
  }
}
