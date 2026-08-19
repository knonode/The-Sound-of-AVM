import { APP_VERSION } from './app-version.js'

// Release notes, newest first. The version banner shows CHANGELOG[0]; the
// "What's new" tab in the info modal shows every entry.
//
// When you ship: bump `version` in package.json, add an entry here with the same
// version string, commit, tag. The console warning below fires if the two drift.
export const CHANGELOG = [
  {
    version: '0.10.0',
    date: '2026-08-19',
    highlights: [
      'A MIDI keyboard you can play into the mempool: + MIDI in the second row. Every key becomes a real transaction, and you hear it when it comes back — the delay is the instrument.',
      'The keyboard belongs to nobody. It is an escrow with no private key, so several people can play the same one at once, with no server in between.',
      'Your patch travels with your notes, so other players hear you in the sound you designed. Others in the second row turns that on, and narrows a session to one player.',
      'Addresses accept NFDs — type hampelman.algo instead of pasting 58 characters.',
      'Synth cards can be reordered, by dragging the grab strip under the header or with the keyboard. The order is part of the layout, so a preset keeps it.',
      'Every control you can reach by Tab now has a focus ring you can see.',
      'Fixed: transactions signed by a logic signature or a multisig could be mistaken for duplicates of each other and dropped before they were heard.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-07-26',
    // Keep these short — they're read in a one-line banner as often as in the modal.
    highlights: [
      'First numbered release. The version now shows in the footer, and this card will tell you what changed on each new one.',
      'A how-to guide, in the (i) beside the title — every control on a synth, in the order you would reach for it.',
      'Territory visualization: every transaction claims its share of the screen and squeezes the standing ground aside.',
      'Kintsugi Ledger and Music Box visualizations.',
      'Locally saved presets can be deleted from the load menu — the X on the right of each row.',
      'Shareable links: load a premade preset or a minted NFPreset and the address bar follows, so copying the URL is all it takes to pass it on.',
    ],
  },
]

if (CHANGELOG[0].version !== APP_VERSION) {
  console.warn(
    `[SOA] Changelog is out of step with package.json: app is v${APP_VERSION}, ` +
      `newest changelog entry is v${CHANGELOG[0].version}. Add an entry in src/legacy/changelog.js.`,
  )
}
