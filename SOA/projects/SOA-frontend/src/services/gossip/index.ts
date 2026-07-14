// GossipAPI: push-based mempool ingestion over the public Algorand relay
// gossip WebSocket, plus a nodely block follower. Replaces the old
// polling-based AlgorandAPI. Every transaction arrives as it propagates,
// with its real arrival time — no polling, no count-diffing, no tokens.

import { Tag, decodeTxPayload, encodeMessageOfInterest, splitTag } from './protocol'
import { normalizeSignedTxn, sanitizeRaw, dedupKey, NormalizedTx } from './normalize'
import { startBlockFollower, BlockSignal } from './blocks'

export const GOSSIP_URL = 'wss://mainnet-gw.4160.nodely.dev/v1/mainnet-v1.0/gossip'

/**
 * One event per atomic group: members buffered briefly after the first
 * arrives, then flushed with the union of the resources they touch.
 * A DEX swap of ASA X always shows X in `assets`.
 */
export interface GroupSignal {
  txn: {
    type: 'group'
    grp: string
    size: number
    /** union of xaid + apas + faid + caid across members */
    assets: number[]
    /** union of apid + apfa across members */
    apids: number[]
    /** distinct member types, e.g. ['appl','axfer'] */
    types: string[]
  }
  members: NormalizedTx[]
  receivedAt: number
}

export type TxCallback = (txType: string, txData: NormalizedTx | BlockSignal | GroupSignal) => void
export type StatusCallback = (state: 'connecting' | 'open' | 'closed' | 'error', detail?: string) => void

let ws: WebSocket | null = null
let stopBlocks: (() => void) | null = null
let running = false
let latestRound = 0

// Two-generation dedup: relays can rebroadcast a pending txn.
const DEDUP_LIMIT = 8192
let seenCurrent = new Set<string>()
let seenPrevious = new Set<string>()

function isDuplicate(key: string): boolean {
  if (seenCurrent.has(key) || seenPrevious.has(key)) return true
  seenCurrent.add(key)
  if (seenCurrent.size >= DEDUP_LIMIT) {
    seenPrevious = seenCurrent
    seenCurrent = new Set()
  }
  return false
}

// --- Atomic group buffering ---
const GROUP_FLUSH_MS = 300
const MAX_GROUP_SIZE = 16
const groupBuffers = new Map<string, { members: NormalizedTx[]; timer: ReturnType<typeof setTimeout> }>()

function flushGroup(grp: string, onTx: TxCallback) {
  const buf = groupBuffers.get(grp)
  if (!buf) return
  groupBuffers.delete(grp)

  const assets = new Set<number>()
  const apids = new Set<number>()
  const types = new Set<string>()
  let receivedAt = Infinity
  for (const m of buf.members) {
    const t = m.txn
    types.add(String(t.type))
    receivedAt = Math.min(receivedAt, m.receivedAt)
    for (const f of ['xaid', 'faid', 'caid'] as const) {
      if (typeof t[f] === 'number') assets.add(t[f] as number)
    }
    if (Array.isArray(t.apas)) for (const a of t.apas as number[]) assets.add(a)
    if (typeof t.apid === 'number') apids.add(t.apid)
    if (Array.isArray(t.apfa)) for (const a of t.apfa as number[]) apids.add(a)
  }

  onTx('group', {
    txn: {
      type: 'group',
      grp,
      size: buf.members.length,
      assets: [...assets],
      apids: [...apids],
      types: [...types],
    },
    members: buf.members,
    receivedAt: receivedAt === Infinity ? Date.now() : receivedAt,
  })
}

function bufferGroupMember(tx: NormalizedTx, onTx: TxCallback) {
  const grp = tx.txn.grp as string
  let buf = groupBuffers.get(grp)
  if (!buf) {
    buf = { members: [], timer: setTimeout(() => flushGroup(grp, onTx), GROUP_FLUSH_MS) }
    groupBuffers.set(grp, buf)
  }
  buf.members.push(tx)
  if (buf.members.length >= MAX_GROUP_SIZE) {
    clearTimeout(buf.timer)
    flushGroup(grp, onTx)
  }
}

function clearGroupBuffers() {
  for (const buf of groupBuffers.values()) clearTimeout(buf.timer)
  groupBuffers.clear()
}

function connect(onTx: TxCallback, onStatus: StatusCallback) {
  let backoff = 500

  const open = () => {
    if (!running) return
    onStatus('connecting', GOSSIP_URL)

    let sock: WebSocket
    try {
      sock = new WebSocket(GOSSIP_URL)
    } catch (err) {
      onStatus('error', (err as Error).message)
      schedule()
      return
    }
    sock.binaryType = 'arraybuffer'
    ws = sock

    sock.onopen = () => {
      backoff = 500
      onStatus('open')
      sock.send(encodeMessageOfInterest([Tag.Txn]))
    }

    sock.onmessage = (ev) => {
      if (typeof ev.data === 'string') return
      const { tag, payload } = splitTag(new Uint8Array(ev.data as ArrayBuffer))
      if (tag !== Tag.Txn) return // relay echoes MI and may send other tags
      const receivedAt = Date.now()
      let decoded: unknown[]
      try {
        decoded = decodeTxPayload(payload)
      } catch (err) {
        console.warn('Gossip decode error:', err)
        return
      }
      for (const raw of decoded) {
        const tx = normalizeSignedTxn(raw, receivedAt)
        if (!tx) continue
        if (isDuplicate(dedupKey(tx))) continue
        // State proofs carry their full decoded body for the overlay viz
        if (tx.txn.type === 'stpf') tx.raw = sanitizeRaw(raw)
        onTx(String(tx.txn.type ?? 'pay'), tx)
        if (typeof tx.txn.grp === 'string') bufferGroupMember(tx, onTx)
      }
    }

    sock.onerror = () => onStatus('error', 'websocket error')
    sock.onclose = (ev) => {
      onStatus('closed', `code=${ev.code}`)
      schedule()
    }
  }

  const schedule = () => {
    if (!running) return
    const delay = backoff
    backoff = Math.min(backoff * 2, 15_000)
    setTimeout(open, delay)
  }

  open()
}

/**
 * Start streaming. The callback receives ('pay'|'axfer'|..., NormalizedTx)
 * per transaction as it propagates, and ('block', BlockSignal) per certified
 * round. Resolves true once the relay socket opens (false on timeout).
 */
export function start(onTx: TxCallback, onStatus: StatusCallback = () => {}): Promise<boolean> {
  if (running) stop()
  running = true
  seenCurrent = new Set()
  seenPrevious = new Set()

  stopBlocks = startBlockFollower((signal) => {
    if (!running) return
    latestRound = signal.round
    onTx('block', signal)
  })

  return new Promise((resolve) => {
    let settled = false
    const settle = (ok: boolean) => {
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }
    const timeout = setTimeout(() => settle(false), 10_000)
    connect(onTx, (state, detail) => {
      if (state === 'open') {
        clearTimeout(timeout)
        settle(true)
      }
      onStatus(state, detail)
    })
  })
}

export function stop(): void {
  running = false
  stopBlocks?.()
  stopBlocks = null
  clearGroupBuffers()
  ws?.close()
  ws = null
}

export function isRunning(): boolean {
  return running
}

export function getLatestBlockRound(): number | null {
  return latestRound > 0 ? latestRound : null
}

export const GossipAPI = { start, stop, isRunning, getLatestBlockRound }
export default GossipAPI
