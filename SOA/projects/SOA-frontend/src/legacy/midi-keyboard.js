// MIDI over the mempool.
//
// A note is a transaction: a zero-amount transfer of an asset that does not
// exist. Zero amounts never look up a holding, so the asset ID is free to mean
// something else — here, the note and how hard it was struck:
//
//     xaid = 2^40 + midiNote*1000 + velocity
//
// The transactions are signed by a logic signature (tools/midi/keyboard.teal),
// so there is no private key anywhere: the instrument is an address, and anyone
// holding the program can play it at the same time as anyone else. Algorand has
// no nonces, so simultaneous players never collide.
//
// Nothing here plays a sound. A note is heard the same way every other
// transaction is heard — by coming back through the relay's gossip feed, a
// round trip later. The mempool is the delay line.

import algosdk from 'algosdk'

// 2^40, three orders of magnitude above the highest real asset ID, so a note
// can never be mistaken for a transfer of something that exists. The escrow
// refuses to sign anything outside NOTE_BASE .. NOTE_BASE + NOTE_SPAN.
export const NOTE_BASE = 1099511627776
export const NOTE_SPAN = 128000

// The compiled keyboard.teal. Committed rather than compiled at runtime: the
// program is the instrument's identity, and recompiling a changed one would
// silently move the address out from under everybody.
const KEYBOARD_PROGRAM_B64 = 'CjEQgQQSMRKBABIQMQGB6AcOEDETMgMSEDEVMgMSEDEgMgMSEDERgYCAgICAIA8QMRGBgOiHgIAgDBA='

// Hardcoded to mainnet, for the same reason GOSSIP_URL is: what you play has to
// arrive on the network you are listening to.
const ALGOD_SERVER = 'https://mainnet-api.4160.nodely.dev'

// A ceiling on how fast one browser will put notes into the mempool. Fast
// passages are unplayable anyway — a round trip is most of a second and gossip
// makes no ordering promise — so this costs nothing musically and keeps an
// enthusiastic glissando from becoming a flood.
const MAX_NOTES_PER_SECOND = 12

// A note with no player address goes to nobody, which is legal for a zero
// transfer and is the honest default: an unsigned postcard rather than a
// borrowed name.
export const ZERO_ADDRESS = algosdk.ALGORAND_ZERO_ADDRESS_STRING
export const isValidPlayer = (address) => algosdk.isValidAddress(address)

// A voice can also arrive on its own, on an asset ID inside the range the escrow
// already signs but that no keyboard can produce: velocity stops at 127, so the
// tail of note 0's slot is free. Nothing in the app sends these — a voice rides
// on a note instead, for free — but the probe does, and reading them costs one
// comparison, so the reserved space stays understood rather than forgotten.
export const PATCH_ASSET = NOTE_BASE + 999
export const isPatchAsset = (xaid) => xaid === PATCH_ASSET

export const isNoteAsset = (xaid) =>
  typeof xaid === 'number' && xaid >= NOTE_BASE && xaid < NOTE_BASE + NOTE_SPAN

// Each note owns a thousand asset IDs, and a keypress only ever needed a
// velocity, so most of that slot has always been empty. It now carries the part
// as well: eight parts of a hundred steps each. That is what lets one player
// send four tracks of a groovebox and have them arrive as four instruments
// rather than one merged stream, while staying one player with one name.
//
// The top two hundred values of every slot stay unreachable from a keyboard.
// PATCH_ASSET lives there, and anything else that is not a note can live there
// later — the escrow already signs those IDs, so the reserved space costs no
// change to the program, and so no change to the instrument's address.
export const PARTS = 8
const PART_SPAN = 100
const VELOCITY_STEPS = 99 // 0..99 within a part; MIDI's 128 levels are finer than a gain needs

/** MIDI's 1..127 into the 0..99 a part slot has room for. */
export const velocityToSteps = (velocity) =>
  Math.max(0, Math.min(VELOCITY_STEPS, Math.round((velocity / 127) * VELOCITY_STEPS)))

export const encodeNote = (midiNote, velocity, part = 0) =>
  NOTE_BASE + midiNote * 1000 + part * PART_SPAN + velocityToSteps(velocity)

/**
 * Pull the note back out of an asset ID. Returns null if it isn't one, which
 * includes the reserved tail of each slot — so a voice announcement can never
 * sound as a bogus note.
 */
export function decodeNote(xaid) {
  if (!isNoteAsset(xaid)) return null
  const offset = xaid - NOTE_BASE
  const slot = offset % 1000
  if (slot >= PARTS * PART_SPAN) return null
  return {
    midiNote: Math.floor(offset / 1000),
    part: Math.floor(slot / PART_SPAN),
    // Back to a 0..1 gain, which is all a velocity was ever used for here.
    velocity: (slot % PART_SPAN) / VELOCITY_STEPS,
  }
}

// --- The instrument ------------------------------------------------------

let algod = null
let keyboard = null
let keyboardAddress = null

function getAlgod() {
  if (!algod) algod = new algosdk.Algodv2('', ALGOD_SERVER, '')
  return algod
}

function getKeyboard() {
  if (!keyboard) {
    const program = Uint8Array.from(atob(KEYBOARD_PROGRAM_B64), (c) => c.charCodeAt(0))
    keyboard = new algosdk.LogicSigAccount(program)
    keyboardAddress = keyboard.address().toString()
  }
  return keyboard
}

export function getKeyboardAddress() {
  getKeyboard()
  return keyboardAddress
}

/** Microalgos in the escrow, or null if it could not be read. */
export async function getKeyboardBalance() {
  try {
    const info = await getAlgod().accountInformation(getKeyboardAddress()).do()
    return Number(info.amount)
  } catch {
    return null
  }
}

// Suggested params are good for a thousand rounds, so fetching them per note
// would be one pointless request per keypress. Refreshed on a slow timer, and
// on demand if a send finds them stale.
let cachedParams = null
let cachedParamsAt = 0
const PARAMS_TTL_MS = 60_000

async function getParams() {
  const now = Date.now()
  if (cachedParams && now - cachedParamsAt < PARAMS_TTL_MS) return cachedParams
  const sp = await getAlgod().getTransactionParams().do()
  sp.flatFee = true
  sp.fee = 1000n
  cachedParams = sp
  cachedParamsAt = now
  return sp
}

// --- Sending -------------------------------------------------------------

let sendLog = []
// When each note went out, so the card can show what the round trip cost. Keyed
// by asset ID: two players striking the same key at once will overwrite each
// other's timestamp, which is a fair price for not tracking every note forever.
const sentAt = new Map()

let stats = { sent: 0, failed: 0, dropped: 0, lastError: null }
export const getMidiStats = () => ({ ...stats })

async function submit(xaid, noteBytes, playerAddress) {
  try {
    const sp = await getParams()
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: getKeyboardAddress(),
      receiver: playerAddress && isValidPlayer(playerAddress) ? playerAddress : ZERO_ADDRESS,
      amount: 0,
      assetIndex: BigInt(xaid),
      note: noteBytes,
      suggestedParams: sp,
    })
    const { blob } = algosdk.signLogicSigTransactionObject(txn, getKeyboard())
    await getAlgod().sendRawTransaction(blob).do()
    stats.sent++
    return xaid
  } catch (err) {
    // A stale validity window is the one failure worth retrying blind, and the
    // cheapest fix is to drop the cache so the next send refetches.
    cachedParams = null
    stats.failed++
    stats.lastError = String(err?.message ?? err).split('\n')[0]
    console.warn('MIDI send rejected:', stats.lastError)
    return null
  }
}

/**
 * Put one note into the mempool. Returns the asset ID it was encoded as, or
 * null if it was dropped (rate cap) or rejected.
 *
 * A note carries eight random bytes so that the same key struck twice at the
 * same velocity inside one validity window isn't a byte-identical transaction
 * the network rejects as a duplicate — repeated notes being what keyboards do.
 * Pass `voiceBytes` and the note carries your sound instead: the fee is flat,
 * so the field is free space, and a listener gets the voice in the same
 * transaction as the note it applies to.
 */
export async function sendNote(midiNote, velocity, playerAddress, voiceBytes = null, part = 0) {
  const now = Date.now()
  sendLog = sendLog.filter((t) => now - t < 1000)
  if (sendLog.length >= MAX_NOTES_PER_SECOND) {
    stats.dropped++
    return null
  }
  sendLog.push(now)

  const xaid = encodeNote(midiNote, velocity, part)
  sentAt.set(xaid, Date.now())
  const carried = voiceBytes && voiceBytes.length <= 1024 ? voiceBytes : crypto.getRandomValues(new Uint8Array(8))
  return submit(xaid, carried, playerAddress)
}


/** Round trip in ms for a note just heard, or null if this browser didn't send it. */
export function claimRoundTrip(xaid) {
  const t = sentAt.get(xaid)
  if (t === undefined) return null
  sentAt.delete(xaid)
  return Date.now() - t
}

// --- Names ---------------------------------------------------------------

// An address is what goes on the transaction, but it is not what anyone calls
// themselves. A player can type an NFD and have it resolved to the account it
// stands for — the SDK is loaded on first use rather than at boot, since most
// sessions never type a name and the bundle is large enough already.
let nfdClient = null
const nfdCache = new Map()

export const looksLikeNfd = (text) => /\.algo$/i.test(text.trim())

/** Resolve an NFD to { name, address }. Throws with a readable message. */
export async function resolveNfd(text) {
  // NFD rejects anything that isn't lowercase, which is a poor reason to tell
  // someone their own name is invalid.
  const name = text.trim().toLowerCase()
  if (nfdCache.has(name)) return nfdCache.get(name)
  if (!nfdClient) {
    const { NfdClient } = await import('@txnlab/nfd-sdk')
    nfdClient = new NfdClient()
  }
  const data = await nfdClient.resolve(name, { view: 'tiny' })
  // depositAccount is the address the name is meant to stand for, and the one
  // a reverse lookup will map back to the name.
  const address = data.depositAccount ?? data.caAlgo?.[0] ?? data.owner
  if (!address) throw new Error(`${name} resolves to no address`)
  const resolved = { name: data.name ?? name, address }
  nfdCache.set(name, resolved)
  return resolved
}

// --- Web MIDI ------------------------------------------------------------

let midiAccess = null

// One physical keyboard can feed several cards at once, each listening on its
// own channel — that is what makes a groovebox's tracks arrive as separate
// parts. So bindings are a registry rather than a single handler, and a device
// carries one message listener however many cards are reading from it.
const bindings = new Map() // cardId -> { inputId, channel, onNoteOn }
const listening = new Set() // inputIds with a message handler attached

/** True if this browser has Web MIDI at all. */
export const midiSupported = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess

/**
 * Ask for MIDI access (prompts the first time) and list the input devices.
 * Throws with a readable message if the browser refuses.
 */
export async function listMidiInputs() {
  if (!midiSupported()) throw new Error('This browser has no Web MIDI. Chrome, Edge or Firefox.')
  if (!midiAccess) midiAccess = await navigator.requestMIDIAccess({ sysex: false })
  return Array.from(midiAccess.inputs.values()).map((input) => ({
    id: input.id,
    name: input.name || input.id,
  }))
}

function handleMessage(input, event) {
  const [status, note, velocity] = event.data
  // Note-on only. A note-off would double the cost and the traffic to control a
  // duration that a second of jitter has already made meaningless — the synth's
  // own gate time is a better answer. Velocity 0 is a note-off in disguise,
  // which is why it is excluded rather than sent as silence.
  if ((status & 0xf0) !== 0x90 || velocity === 0) return
  const channel = (status & 0x0f) + 1
  for (const binding of bindings.values()) {
    if (binding.inputId !== input.id) continue
    // Channel 0 means the card takes the whole device, which is what a
    // single-keyboard player wants and what a groovebox player does not.
    if (binding.channel !== 0 && binding.channel !== channel) continue
    binding.onNoteOn(note, velocity)
  }
}

/**
 * Point one card at one device and channel. Passing no inputId unbinds it.
 * Several cards may hold the same device on different channels.
 */
export function bindMidiCard(cardId, inputId, channel, onNoteOn) {
  unbindMidiCard(cardId)
  if (!inputId || !midiAccess) return
  const input = midiAccess.inputs.get(inputId)
  if (!input) return
  bindings.set(cardId, { inputId, channel, onNoteOn })
  if (!listening.has(inputId)) {
    input.onmidimessage = (event) => handleMessage(input, event)
    listening.add(inputId)
  }
}

export function unbindMidiCard(cardId) {
  const binding = bindings.get(cardId)
  if (!binding) return
  bindings.delete(cardId)
  // The last card off a device turns its listener off with it.
  const stillWanted = [...bindings.values()].some((b) => b.inputId === binding.inputId)
  if (!stillWanted && listening.has(binding.inputId)) {
    const input = midiAccess?.inputs.get(binding.inputId)
    if (input) input.onmidimessage = null
    listening.delete(binding.inputId)
  }
}

/** Fires when devices are plugged or unplugged, so the card can re-list them. */
export function onMidiPortChange(handler) {
  if (midiAccess) midiAccess.onstatechange = handler
}
