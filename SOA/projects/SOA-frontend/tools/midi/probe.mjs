// Probe for the MIDI-over-mempool idea: prove that a note-shaped transaction
// is accepted by mainnet before any of it touches the frontend.
//
//   node tools/midi/probe.mjs            # compile, show the escrow, check shapes
//   node tools/midi/probe.mjs --play     # send a short melody
//
// Run it from SOA/projects/SOA-frontend so algosdk resolves.

import algosdk from 'algosdk'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEAL_PATH = join(HERE, 'keyboard.teal')
const CACHE_PATH = join(HERE, 'keyboard.lsig.b64')

const ALGOD_SERVER = process.env.ALGOD_SERVER ?? 'https://mainnet-api.4160.nodely.dev'
const ALGOD_TOKEN = process.env.ALGOD_TOKEN ?? ''

// The note range. xaid = NOTE_BASE + midiNote*1000 + velocity, and the escrow
// refuses to sign anything outside it. 2^40 is three orders of magnitude above
// the highest real asset ID, so it will not collide with a real ASA.
const NOTE_BASE = 1099511627776n
const noteToAssetId = (midiNote, velocity) => NOTE_BASE + BigInt(midiNote) * 1000n + BigInt(velocity)

// Who played it. The sender is the escrow for every player, so the receiver is
// the only field that can carry an identity — and it costs nothing, because a
// zero transfer never touches the receiver's account.
const PLAYER = process.env.PLAYER_ADDR ?? algosdk.ALGORAND_ZERO_ADDRESS_STRING

// A voice announcement: the asset ID says "this is not a note" (velocity 999 is
// unreachable from a keyboard) and the note field carries the sound itself.
const PATCH_ASSET = NOTE_BASE + 999n
const PROBE_VOICE = {
  v: 1,
  app: 'probe',
  s: {
    engine: 'fm',
    oscillator: { type: 'fatsawtooth' },
    envelope: { attack: 0.02, decay: 0.4, sustain: 0.2, release: 1.2 },
    harmonicity: 1.5,
    modulationIndex: 22,
    volume: -10,
    pan: -0.4,
    filter: { cutoff: 1800 },
    delay: { time: 0.28, feedback: 0.35, wet: 0.3 },
    reverb: { roomSize: 0.8, wet: 0.5 },
    lfo: { rate: 0.7, depth: 30, waveform: 'triangle', destination: 'cutoff' },
    noteDuration: 0.9,
    baseNote: 'A2',
    sequence: [0, 0, 7, 0, 0, -5, 0, 0],
  },
}

// A voice carries a nonce so that two notes carrying the same sound are still
// two different transactions.
const voiceBytes = () =>
  new TextEncoder().encode(JSON.stringify({ ...PROBE_VOICE, n: randomBytes(4).toString('hex') }))

const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const algos = (micro) => (Number(micro) / 1e6).toFixed(6)

async function loadEscrow() {
  let programB64
  if (existsSync(CACHE_PATH)) {
    programB64 = readFileSync(CACHE_PATH, 'utf-8').trim()
  } else {
    const teal = readFileSync(TEAL_PATH, 'utf-8')
    try {
      const compiled = await algod.compile(teal).do()
      programB64 = compiled.result
      writeFileSync(CACHE_PATH, programB64 + '\n')
      console.log(`compiled and cached -> ${CACHE_PATH}`)
    } catch (err) {
      console.error(`could not compile via ${ALGOD_SERVER}: ${err.message}`)
      console.error('Public nodes often disable /v2/teal/compile. Compile once against')
      console.error('a node that allows it and save the base64 program to keyboard.lsig.b64.')
      process.exit(1)
    }
  }
  const program = new Uint8Array(Buffer.from(programB64, 'base64'))
  return new algosdk.LogicSigAccount(program)
}

function buildNote(escrowAddr, receiver, midiNote, velocity, sp, voice = null) {
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: escrowAddr,
    receiver,
    amount: 0,
    assetIndex: noteToAssetId(midiNote, velocity),
    // Two players striking the same key at the same velocity in the same round
    // would otherwise build byte-identical transactions, and the second would be
    // rejected as a duplicate. Eight random bytes make every note its own — or
    // the player's whole sound, which carries its own nonce and costs the same,
    // the fee being flat regardless of size.
    note: voice ?? randomBytes(8),
    suggestedParams: sp,
  })
}

async function submit(txn, lsig) {
  const { txID, blob } = algosdk.signLogicSigTransactionObject(txn, lsig)
  const sentAt = Date.now()
  await algod.sendRawTransaction(blob).do()
  return { txID, sentAt }
}

async function main() {
  const play = process.argv.includes('--play')
  const patch = process.argv.includes('--patch')
  const lsig = await loadEscrow()
  const escrowAddr = lsig.address().toString()

  console.log(`escrow   ${escrowAddr}`)
  console.log(`algod    ${ALGOD_SERVER}`)
  console.log(`player   ${PLAYER}${PLAYER === algosdk.ALGORAND_ZERO_ADDRESS_STRING ? '  (zero address)' : ''}`)

  let balance = 0n
  try {
    const info = await algod.accountInformation(escrowAddr).do()
    balance = BigInt(info.amount)
  } catch {
    console.log('balance  0 (account does not exist yet)')
  }
  if (balance > 0n) console.log(`balance  ${algos(balance)} ALGO`)

  // Fifty notes' worth. Low enough not to stand in the way of a hat that can
  // still be played, high enough to notice before the next note is refused.
  if (balance < 50000n) {
    console.log('')
    console.log('Not enough to play. Send ~1 ALGO to the escrow address above and re-run.')
    console.log('Anyone who knows that address can spend it, 0.001 at a time — fund it')
    console.log('like a busking hat, not like a wallet.')
    return
  }

  const sp = await algod.getTransactionParams().do()
  sp.flatFee = true
  sp.fee = 1000n

  if (patch) {
    // A patch has to name a player: an announcement with no address says
    // "somebody sounds like this", which no listener can act on. A throwaway
    // address is fine for a probe — nobody has to own it to be heard.
    const who = process.env.PLAYER_ADDR ?? algosdk.generateAccount().addr.toString()
    const body = voiceBytes()
    console.log('')
    console.log(`voice   ${body.length} bytes of ${1024} allowed`)
    console.log(`player  ${who}`)
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: escrowAddr,
      receiver: who,
      amount: 0,
      assetIndex: PATCH_ASSET,
      note: body,
      suggestedParams: sp,
    })
    try {
      const { txID, sentAt } = await submit(txn, lsig)
      console.log(`${new Date(sentAt).toISOString().slice(11, 23)}  announced  ${txID}`)
    } catch (err) {
      console.log(`patch rejected: ${err.message?.split('\n')[0]}`)
    }
    return
  }

  if (!play) {
    // The three questions the design rests on. ~0.003 ALGO to answer all of them.
    const shapes = [
      ['zero address receiver', algosdk.ALGORAND_ZERO_ADDRESS_STRING, true],
      ['fresh unfunded receiver', algosdk.generateAccount().addr.toString(), true],
      ['receiver == escrow (opt-in branch)', escrowAddr, false],
    ]
    for (const [label, receiver, expectAccepted] of shapes) {
      const txn = buildNote(escrowAddr, receiver, 60, 100, sp)
      try {
        const { txID } = await submit(txn, lsig)
        console.log(`${expectAccepted ? 'ok  ' : 'HUH '} ${label} -> accepted, ${txID}`)
      } catch (err) {
        const msg = err.message?.split('\n')[0] ?? String(err)
        console.log(`${expectAccepted ? 'FAIL' : 'ok  '} ${label} -> rejected: ${msg}`)
      }
      await sleep(500)
    }
    console.log('')
    console.log('Accepted transactions are in the mempool now. If the sonifier is running')
    console.log('with an axfer synth, they went past unheard — nothing filters for them yet.')
    return
  }

  // A slow arpeggio. Slow because the mempool is the delay line: a round trip
  // is most of a second, and gossip does not promise to deliver in order.
  const melody = [
    [60, 100], [64, 90], [67, 95], [72, 110],
    [67, 85], [64, 80], [60, 75], [55, 70],
  ]
  // Play under a name, the way the app does — a voice filed against nobody is
  // a voice no listener can use.
  const who = PLAYER === algosdk.ALGORAND_ZERO_ADDRESS_STRING ? algosdk.generateAccount().addr.toString() : PLAYER
  console.log('')
  console.log(`player  ${who}`)
  console.log(`voice   ${voiceBytes().length} bytes on every note`)
  console.log('')
  for (const [midiNote, velocity] of melody) {
    const txn = buildNote(escrowAddr, who, midiNote, velocity, sp, voiceBytes())
    try {
      const { txID, sentAt } = await submit(txn, lsig)
      console.log(`${new Date(sentAt).toISOString().slice(11, 23)}  note ${midiNote} vel ${velocity}  xaid ${noteToAssetId(midiNote, velocity)}  ${txID}`)
    } catch (err) {
      console.log(`note ${midiNote} rejected: ${err.message?.split('\n')[0]}`)
    }
    await sleep(700)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
