// The app version, single-sourced from SOA-frontend/package.json and substituted
// here at build time by the `define` block in vite.config.ts.
//
// The `typeof` guard costs nothing (vite replaces the bare identifier with a string
// literal, so this folds to `typeof "0.9.0"`) but keeps the module importable from
// contexts without the define — a bare node script, a test runner — instead of
// throwing a ReferenceError on load.
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'
