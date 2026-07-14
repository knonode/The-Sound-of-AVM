// Block follower: long-polls nodely's wait-for-block-after and emits one
// 'block' signal per certified round, carrying the next state proof round
// from the block header (spt[0].n) for the stpf countdown.

const NODELY_BASE = 'https://mainnet-api.4160.nodely.dev'
const MAX_CATCHUP = 5 // don't replay long gaps after a connection hiccup

export interface BlockSignal {
  txn: { type: 'block'; round: number; snd: string; rcv: null }
  round: number
  nextStateProofRound: number | null
}

export type BlockCallback = (signal: BlockSignal) => void

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${NODELY_BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

export function startBlockFollower(onBlock: BlockCallback): () => void {
  let running = true
  let lastRound = 0

  const emit = (round: number, nextStateProofRound: number | null) => {
    onBlock({
      txn: { type: 'block', round, snd: 'ALGORAND-PROTOCOL', rcv: null },
      round,
      nextStateProofRound,
    })
  }

  interface BlockResponse {
    block?: {
      rnd?: number
      round?: number
      spt?: Record<string, { n?: number }>
    }
  }

  const fetchAndEmit = async (round: number) => {
    const data = (await getJson(`/v2/blocks/${round}`)) as BlockResponse
    const actualRound = data.block?.rnd ?? data.block?.round ?? round
    const nextSpt = data.block?.spt?.[0]?.n ?? null
    emit(actualRound, typeof nextSpt === 'number' ? nextSpt : null)
  }

  ;(async () => {
    let backoff = 1000
    while (running) {
      try {
        if (lastRound === 0) {
          const status = await getJson('/v2/status')
          lastRound = Number(status['last-round'])
          if (!Number.isFinite(lastRound) || lastRound <= 0) throw new Error('bad last-round')
        }
        const status = await getJson(`/v2/status/wait-for-block-after/${lastRound}`)
        if (!running) break
        const newRound = Number(status['last-round'])
        if (newRound > lastRound) {
          const from = Math.max(lastRound + 1, newRound - MAX_CATCHUP + 1)
          for (let r = from; r <= newRound && running; r++) {
            await fetchAndEmit(r)
          }
          lastRound = newRound
        }
        backoff = 1000
      } catch (err) {
        if (!running) break
        console.warn('Block follower error, retrying:', err)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        backoff = Math.min(backoff * 2, 10_000)
      }
    }
  })()

  return () => {
    running = false
  }
}
