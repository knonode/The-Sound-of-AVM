// Normalize a msgpack-decoded SignedTxn into the algod-REST-like JSON shape
// the synth's matching logic (checkTransactionMatch) already understands:
// base32 address strings, plain numbers, base64 group ids.

import algosdk from 'algosdk'

export interface NormalizedTx {
  txn: Record<string, unknown>
  sig?: string
  receivedAt: number
  /** Full sanitized decode, attached only for rare heavyweight txs (stpf) */
  raw?: unknown
}

/**
 * Deep JSON-friendly conversion of a msgpack decode: BigInt -> string,
 * Uint8Array -> base64 string, recurse into arrays/objects.
 */
export function sanitizeRaw(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'bigint') return (value as bigint).toString()
  if (t === 'number' || t === 'string' || t === 'boolean') return value
  if (value instanceof Uint8Array) return toB64(value)
  if (Array.isArray(value)) return value.map(sanitizeRaw)
  if (t === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeRaw(v)
    }
    return out
  }
  return String(value)
}

const ADDRESS_FIELDS = ['snd', 'rcv', 'arcv', 'asnd', 'aclose', 'close', 'fadd', 'rekey'] as const
const NUMBER_FIELDS = [
  'fee',
  'fv',
  'lv',
  'amt',
  'aamt',
  'xaid',
  'apid',
  'faid',
  'caid',
  'apan',
  'votefst',
  'votelst',
  'votekd',
  'sptype',
] as const
const NUMBER_ARRAY_FIELDS = ['apas', 'apfa'] as const
const BOOL_FIELDS = ['afrz', 'nonpart'] as const

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return undefined
}

function toAddr(v: unknown): string | undefined {
  if (v instanceof Uint8Array && v.length === 32) return algosdk.encodeAddress(v)
  return undefined
}

function toB64(v: unknown): string | undefined {
  if (!(v instanceof Uint8Array)) return undefined
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < v.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(v.subarray(i, i + CHUNK)))
  }
  return btoa(s)
}

export function normalizeSignedTxn(raw: unknown, receivedAt: number): NormalizedTx | null {
  if (!raw || typeof raw !== 'object') return null
  const st = raw as Record<string, unknown>
  const t = st.txn as Record<string, unknown> | undefined
  if (!t || typeof t !== 'object') return null

  const txn: Record<string, unknown> = { type: t.type }

  for (const f of ADDRESS_FIELDS) {
    const a = toAddr(t[f])
    if (a !== undefined) txn[f] = a
  }
  for (const f of NUMBER_FIELDS) {
    const n = toNum(t[f])
    if (n !== undefined) txn[f] = n
  }
  for (const f of NUMBER_ARRAY_FIELDS) {
    const arr = t[f]
    if (Array.isArray(arr)) txn[f] = arr.map(toNum).filter((n): n is number => n !== undefined)
  }
  for (const f of BOOL_FIELDS) {
    if (typeof t[f] === 'boolean') txn[f] = t[f]
  }

  // apat is an array of 32-byte account addresses
  if (Array.isArray(t.apat)) {
    txn.apat = t.apat.map(toAddr).filter((a): a is string => a !== undefined)
  }
  // Group id as base64 — the key for group-as-unit matching
  const grp = toB64(t.grp)
  if (grp !== undefined) txn.grp = grp
  // votekey presence distinguishes keyreg online from offline
  const votekey = toB64(t.votekey)
  if (votekey !== undefined) txn.votekey = votekey

  // Heartbeat target account (txn.hb.a) — lets a node runner hear their own node
  const hb = t.hb as Record<string, unknown> | undefined
  if (hb && typeof hb === 'object') {
    const hbad = toAddr(hb.a)
    if (hbad !== undefined) txn.hbad = hbad
  }

  return { txn, sig: toB64(st.sig), receivedAt }
}

// Dedup key: the signature is unique per signed transaction. Fall back to a
// cheap composite for msig/lsig-signed txns (a rare duplicate just double-blips).
export function dedupKey(tx: NormalizedTx): string {
  if (tx.sig) return tx.sig
  const t = tx.txn
  return `${t.type}:${t.snd}:${t.fv}:${t.lv}:${t.fee}:${t.grp ?? ''}`
}
