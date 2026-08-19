import { normalizeSignedTxn, dedupKey } from './normalize'

const addr = (fill: number) => new Uint8Array(32).fill(fill)

/**
 * A logic-signed asset transfer, shaped the way the MIDI keyboard sends them:
 * one escrow, one validity window, one fee, and the note itself carried in the
 * asset ID. Nothing here has a `sig`, which is what makes dedup interesting.
 */
function note(xaid: number, nonce: number[], receiver = addr(2)) {
  return {
    lsig: { l: new Uint8Array([1, 2, 3]) },
    txn: {
      type: 'axfer',
      snd: addr(1),
      arcv: receiver,
      xaid,
      aamt: 0,
      fee: 1000,
      fv: 40000000,
      lv: 40001000,
      note: new Uint8Array(nonce),
    },
  }
}

describe('dedupKey', () => {
  it('uses the signature when there is one', () => {
    const tx = normalizeSignedTxn({ sig: new Uint8Array(64).fill(7), txn: { type: 'pay', snd: addr(1) } }, 0)!
    expect(dedupKey(tx)).toBe(tx.sig)
  })

  it('tells two different notes apart in one validity window', () => {
    // Same sender, fee and window: before the asset ID was part of the key,
    // every note after the first in a given minute was dropped as a duplicate.
    const c = normalizeSignedTxn(note(1099511687776, [1, 1, 1, 1]), 0)!
    const e = normalizeSignedTxn(note(1099511691776, [2, 2, 2, 2]), 0)!
    expect(dedupKey(c)).not.toBe(dedupKey(e))
  })

  it('tells the same note struck twice apart', () => {
    const first = normalizeSignedTxn(note(1099511687776, [1, 2, 3, 4]), 0)!
    const again = normalizeSignedTxn(note(1099511687776, [5, 6, 7, 8]), 0)!
    expect(dedupKey(first)).not.toBe(dedupKey(again))
  })

  it('tells two players striking the same key apart', () => {
    const one = normalizeSignedTxn(note(1099511687776, [1, 2, 3, 4], addr(3)), 0)!
    const two = normalizeSignedTxn(note(1099511687776, [1, 2, 3, 4], addr(4)), 0)!
    expect(dedupKey(one)).not.toBe(dedupKey(two))
  })

  it('still recognises a genuine rebroadcast', () => {
    const sent = normalizeSignedTxn(note(1099511687776, [9, 9, 9, 9]), 0)!
    const echo = normalizeSignedTxn(note(1099511687776, [9, 9, 9, 9]), 1200)!
    expect(dedupKey(sent)).toBe(dedupKey(echo))
  })
})
