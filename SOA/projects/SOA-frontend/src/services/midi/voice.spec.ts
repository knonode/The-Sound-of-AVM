import { packVoice, unpackVoice, sanitizeVoice, voiceFingerprint, VOICE_FORMAT } from './voice'

const designed = {
  engine: 'fm',
  oscillator: { type: 'fatsawtooth' },
  envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
  detune: 7,
  harmonicity: 3,
  modulationIndex: 10,
  filterEnvelope: { attack: 0.6, decay: 0.2, sustain: 0.5, release: 2 },
  volume: -8,
  pan: 0.25,
  pitch: -12,
  filter: { cutoff: 2400 },
  delay: { time: 0.33, feedback: 0.4, wet: 0.25 },
  reverb: { roomSize: 0.7, wet: 0.4 },
  lfo: { rate: 5, depth: 20, waveform: 'square', destination: 'pitch' },
  noteDuration: 0.4,
  baseNote: 'C4',
  sequence: [0, 3, 7, 0, -5, 0, 12, 0],
  // Runtime state that belongs to a card, not to a sound
  muted: true,
  currentStepIndex: 5,
  triggerCap: 24,
}

describe('voice on the wire', () => {
  it('round-trips a designed voice', () => {
    const back = unpackVoice(packVoice(designed))!
    expect(back.engine).toBe('fm')
    expect(back.oscillator).toEqual({ type: 'fatsawtooth' })
    expect(back.delay).toEqual({ time: 0.33, feedback: 0.4, wet: 0.25 })
    expect(back.lfo).toEqual({ rate: 5, depth: 20, waveform: 'square', destination: 'pitch' })
    expect(back.sequence).toEqual([0, 3, 7, 0, -5, 0, 12, 0])
    expect(back.baseNote).toBe('C4')
    expect(back.pitch).toBe(-12)
  })

  it('fits a whole voice in a transaction note field', () => {
    expect(packVoice(designed, '0.9.0').length).toBeLessThan(1024)
  })

  it('is never the same transaction twice', () => {
    // Two sends of one unchanged sound must still differ, or the network
    // rejects the second as a duplicate of the first.
    expect(new TextDecoder().decode(packVoice(designed))).not.toBe(new TextDecoder().decode(packVoice(designed)))
  })

  describe('fingerprint', () => {
    it('ignores the nonce that makes each send unique', () => {
      expect(voiceFingerprint(designed)).toBe(voiceFingerprint({ ...designed }))
    })

    it('ignores card state that is not the sound', () => {
      expect(voiceFingerprint({ ...designed, muted: false, currentStepIndex: 2 })).toBe(voiceFingerprint(designed))
    })

    it('notices a knob that moved', () => {
      expect(voiceFingerprint({ ...designed, volume: -9 })).not.toBe(voiceFingerprint(designed))
    })
  })

  it('never carries a card mute or a sequencer position', () => {
    const back = unpackVoice(packVoice(designed))!
    expect(back.muted).toBeUndefined()
    expect(back.currentStepIndex).toBeUndefined()
    expect(back.triggerCap).toBeUndefined()
  })

  describe('a stranger cannot', () => {
    it('exceed the ceiling a card has itself', () => {
      expect(sanitizeVoice({ volume: 40 }).volume).toBe(3)
      expect(sanitizeVoice({ volume: -400 }).volume).toBe(-40)
      expect(sanitizeVoice({ noteDuration: 900 }).noteDuration).toBe(20)
    })

    it('run a delay line away', () => {
      expect((sanitizeVoice({ delay: { feedback: 0.999 } }).delay as { feedback: number }).feedback).toBe(0.9)
    })

    it('keeps a long gate that a card would also allow', () => {
      expect(sanitizeVoice({ noteDuration: 20 }).noteDuration).toBe(20)
    })

    it('send something that is not a number', () => {
      const v = sanitizeVoice({ volume: 'loud', pan: null, pitch: NaN, filter: { cutoff: Infinity } })
      expect(v.volume).toBe(-8)
      expect(v.pan).toBe(0)
      expect(v.pitch).toBe(0)
      expect((v.filter as { cutoff: number }).cutoff).toBe(20000)
    })

    it('name an engine or waveform that does not exist', () => {
      const v = sanitizeVoice({ engine: 'DROP TABLE', oscillator: { type: '../../etc' } })
      expect(v.engine).toBe('polysynth')
      expect(v.oscillator).toEqual({ type: 'sine' })
    })

    it('send a base note Tone cannot parse', () => {
      expect(sanitizeVoice({ baseNote: 'H99' }).baseNote).toBe('C4')
      expect(sanitizeVoice({ baseNote: 'C4' }).baseNote).toBe('C4')
    })

    it('send a sequence of the wrong length or type', () => {
      expect(sanitizeVoice({ sequence: 'nope' }).sequence).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
      expect(sanitizeVoice({ sequence: [99, -99] }).sequence).toEqual([24, -24, 0, 0, 0, 0, 0, 0])
    })
  })

  describe('rejects outright', () => {
    it('bytes that are not JSON', () => {
      expect(unpackVoice(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    })

    it('JSON that is not a voice', () => {
      expect(unpackVoice(new TextEncoder().encode('{"hello":"world"}'))).toBeNull()
      expect(unpackVoice(new TextEncoder().encode('"a string"'))).toBeNull()
    })

    it('a format from the future', () => {
      const future = new TextEncoder().encode(JSON.stringify({ v: VOICE_FORMAT + 1, s: designed }))
      expect(unpackVoice(future)).toBeNull()
    })
  })
})
