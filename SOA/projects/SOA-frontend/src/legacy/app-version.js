// The app version, single-sourced from SOA-frontend/package.json and substituted
// here at build time by the `define` block in vite.config.ts.
//
// The `typeof` guard costs nothing (vite replaces the bare identifier with a string
// literal, so this folds to `typeof "0.9.0"`) but keeps the module importable from
// contexts without the define — a bare node script, a test runner — instead of
// throwing a ReferenceError on load.
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'

if (APP_VERSION === '0.0.0-dev') {
  // Usually a dev server that was already running when the define was added or
  // the version bumped — vite reads package.json once, at config load. Worth
  // saying out loud, because this string gets stamped into any preset saved now.
  console.warn('[SOA] No build version available; using 0.0.0-dev. Restart the dev server to pick up package.json.')
}
