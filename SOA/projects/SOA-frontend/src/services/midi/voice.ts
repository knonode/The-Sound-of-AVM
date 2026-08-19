// A voice on the wire.
//
// The MIDI keyboard is played by anyone who has the program, so the sound a
// player designed has to travel with them or everyone hears everyone else in
// the same tone. It travels in the transaction note field — 1024 bytes, where
// a fully designed voice serialises to about 520 — which means there is no
// encoding problem to solve, only a trust one: this is a stranger's data being
// applied to your audio graph, and every number in it has to be forced into a
// range that cannot hurt you before it reaches Tone.

/** Bumped when the payload shape changes in a way old readers can't handle. */
export const VOICE_FORMAT = 1

/** Asset IDs at or above this are the keyboard's own traffic. */
export const KEYBOARD_ASSET_FLOOR = 1099511627776

export interface VoicePayload {
  /** Payload format */
  v: number
  /** App version that wrote it, for routing a preset to old behaviour */
  app?: string
  /** Nonce, so two identical voices are never two identical transactions */
  n?: string
  /** The settings themselves */
  s: Record<string, unknown>
}

const ENGINES = ['synth', 'monosynth', 'polysynth', 'am', 'fm']
const WAVEFORMS = ['sine', 'square', 'triangle', 'sawtooth', 'fatsine', 'fatsquare', 'fattriangle', 'fatsawtooth']
const LFO_WAVEFORMS = ['sine', 'square', 'triangle', 'sawtooth']
const LFO_DESTINATIONS = ['none', 'pitch', 'volume', 'cutoff', 'delayTime']
const BASE_NOTE = /^[A-G]#?-?[0-8]$/

// Runtime state that belongs to a card, not to a sound. Sending these would
// let a patch mute your synth or reset its sequencer position.
const NOT_SOUND = ['muted', 'mutedByMaster', 'savedVolume', 'currentStepIndex', 'triggerCap']

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const oneOf = (value: unknown, allowed: string[], fallback: string): string =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/**
 * Force an incoming voice into ranges Tone can actually take, and reject
 * anything that isn't a number, an engine, or a note name at all. The ceilings
 * match what the UI offers its own user rather than sitting below them — the
 * sonifier runs quiet, and a remote player held to half the range would just
 * sound broken next to a local card.
 */
export function sanitizeVoice(raw: unknown): Record<string, unknown> {
  const s = obj(raw)
  const envelope = obj(s.envelope)
  const filterEnvelope = obj(s.filterEnvelope)
  const delay = obj(s.delay)
  const reverb = obj(s.reverb)
  const lfo = obj(s.lfo)
  const filter = obj(s.filter)

  const rawSequence: unknown[] = Array.isArray(s.sequence) ? s.sequence : []
  const sequence = Array.from({ length: 8 }, (_, i) => Math.round(num(rawSequence[i], -24, 24, 0)))

  return {
    engine: oneOf(s.engine, ENGINES, 'polysynth'),
    oscillator: { type: oneOf(obj(s.oscillator).type, WAVEFORMS, 'sine') },
    envelope: {
      attack: num(envelope.attack, 0.001, 10, 0.01),
      decay: num(envelope.decay, 0.001, 10, 0.2),
      sustain: num(envelope.sustain, 0, 1, 0.3),
      release: num(envelope.release, 0.001, 10, 0.2),
    },
    filterEnvelope: {
      attack: num(filterEnvelope.attack, 0.001, 10, 0.6),
      decay: num(filterEnvelope.decay, 0.001, 10, 0.2),
      sustain: num(filterEnvelope.sustain, 0, 1, 0.5),
      release: num(filterEnvelope.release, 0.001, 10, 2),
    },
    detune: num(s.detune, -1200, 1200, 0),
    harmonicity: num(s.harmonicity, 0.1, 20, 3),
    modulationIndex: num(s.modulationIndex, 0, 100, 10),
    // The same ceiling the card's own volume slider has.
    volume: num(s.volume, -40, 3, -8),
    pan: num(s.pan, -1, 1, 0),
    pitch: Math.round(num(s.pitch, -24, 24, 0)),
    filter: { cutoff: num(filter.cutoff, 20, 20000, 20000) },
    delay: {
      time: num(delay.time, 0, 4, 0),
      // The UI stops at 0.95, which is already close to self-oscillation. A
      // stranger's delay line gets less rope.
      feedback: num(delay.feedback, 0, 0.9, 0),
      wet: num(delay.wet, 0, 1, 0),
    },
    reverb: { roomSize: num(reverb.roomSize, 0.05, 0.95, 0.5), wet: num(reverb.wet, 0, 1, 0.3) },
    lfo: {
      rate: num(lfo.rate, 0.01, 30, 5),
      depth: num(lfo.depth, 0, 100, 0),
      waveform: oneOf(lfo.waveform, LFO_WAVEFORMS, 'sine'),
      destination: oneOf(lfo.destination, LFO_DESTINATIONS, 'none'),
    },
    // Twenty seconds, as a card allows. Long gates are the whole point of some
    // patches; the send rate cap is what keeps them from stacking up.
    noteDuration: num(s.noteDuration, 0.01, 20, 0.4),
    baseNote: typeof s.baseNote === 'string' && BASE_NOTE.test(s.baseNote) ? s.baseNote : 'C4',
    sequence,
  }
}

/** A card's settings stripped down to the sound alone. */
function soundOnly(settings: Record<string, unknown>): Record<string, unknown> {
  const sound: Record<string, unknown> = { ...settings }
  for (const key of NOT_SOUND) delete sound[key]
  return sound
}

/**
 * A stable string for "what this card sounds like", with no nonce in it, for
 * deciding whether the sound has actually changed since it was last sent.
 */
export function voiceFingerprint(settings: Record<string, unknown>): string {
  return JSON.stringify(soundOnly(settings))
}

/**
 * Serialise a voice for the note field. The nonce keeps two sends of the same
 * sound from building the same transaction twice — which the network would
 * reject as a duplicate, and which dedup on the way back in would swallow.
 */
export function packVoice(settings: Record<string, unknown>, appVersion?: string): Uint8Array {
  const payload: VoicePayload = {
    v: VOICE_FORMAT,
    s: soundOnly(settings),
    n: Math.random().toString(36).slice(2, 10),
  }
  if (appVersion) payload.app = appVersion
  return new TextEncoder().encode(JSON.stringify(payload))
}

/**
 * Read a voice off the wire. Returns null for anything that isn't one — a
 * malformed payload, a format from the future, or bytes that aren't JSON at
 * all, which the note field of a passing transaction may well be.
 */
export function unpackVoice(bytes: Uint8Array): Record<string, unknown> | null {
  let payload: VoicePayload
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  // A newer format may mean the same keys with different meanings, and voicing
  // it with today's reader would be a quiet lie about what someone designed.
  if (payload.v !== VOICE_FORMAT) return null
  if (!payload.s || typeof payload.s !== 'object') return null
  return sanitizeVoice(payload.s)
}
