import { Buffer } from 'buffer'

/**
 * A minimal representation of a synthesiser preset.
 * The exact structure will evolve but for now we treat it as an open dictionary.
 */
export interface Preset {
  [key: string]: unknown
}

/**
 * Encodes a Preset into a compact Base64 string.
 * TODO: Replace JSON.stringify with a custom CBOR / array encoding for better compression once the data model stabilises.
 */
export function encodePreset(preset: Preset): string {
  const json = JSON.stringify(preset)
  // Node.js environment (tests, SSR) can use Buffer, browsers use btoa
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(json, 'utf-8').toString('base64')
  }
  return btoa(unescape(encodeURIComponent(json)))
}

/**
 * Decodes a Base64 string back into a Preset object.
 */
export function decodePreset(encoded: string): Preset {
  let json: string
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    json = Buffer.from(encoded, 'base64').toString('utf-8')
  } else {
    json = decodeURIComponent(escape(atob(encoded)))
  }
  return JSON.parse(json) as Preset
}
