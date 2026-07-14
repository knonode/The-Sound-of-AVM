// Algorand relay wire protocol, browser side.
//
// Frame layout: [2-byte ASCII tag][payload]. TX payloads are a stream of
// concatenated msgpack SignedTxns (not a msgpack array). Tags documented in
// go-algorand/protocol/tags.go; MessageOfInterest topic encoding in
// go-algorand/network/topics.go.

import { decodeMulti } from '@msgpack/msgpack'

export const Tag = {
  MsgOfInterest: 'MI',
  ProposalPayload: 'PP',
  StateProofSig: 'SP',
  Txn: 'TX',
  AgreementVote: 'AV',
} as const

export function splitTag(buf: Uint8Array): { tag: string; payload: Uint8Array } {
  if (buf.length < 2) return { tag: '', payload: buf }
  return { tag: String.fromCharCode(buf[0]!, buf[1]!), payload: buf.subarray(2) }
}

function putUvarint(out: number[], n: number): void {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  out.push(n & 0x7f)
}

// One topic: key="tags", data="TX,..." (comma-joined tag list).
export function encodeMessageOfInterest(tags: readonly string[]): Uint8Array {
  const enc = new TextEncoder()
  const key = enc.encode('tags')
  const data = enc.encode(tags.join(','))
  const body: number[] = []
  putUvarint(body, 1)
  putUvarint(body, key.length)
  for (const b of key) body.push(b)
  putUvarint(body, data.length)
  for (const b of data) body.push(b)
  const out = new Uint8Array(2 + body.length)
  out[0] = Tag.MsgOfInterest.charCodeAt(0)
  out[1] = Tag.MsgOfInterest.charCodeAt(1)
  out.set(body, 2)
  return out
}

export function decodeTxPayload(payload: Uint8Array): unknown[] {
  return Array.from(decodeMulti(payload, { useBigInt64: true }))
}
