import { APP_VERSION } from './app-version.js'

// Release notes, newest first. The version banner shows CHANGELOG[0]; the
// "What's new" tab in the info modal shows every entry.
//
// When you ship: bump `version` in package.json, add an entry here with the same
// version string, commit, tag. The console warning below fires if the two drift.
export const CHANGELOG = [
  {
    version: '0.9.0',
    date: '2026-07-26',
    // Keep these short — they're read in a one-line banner as often as in the modal.
    highlights: [
      'First numbered release. The version now shows in the footer, and this banner will tell you what changed on each new one.',
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
