# The Sound of AVM

A live sonifier for the Algorand mempool. It connects directly to a relay's
gossip WebSocket, decodes signed transactions as they arrive, and plays them
through per-type synths built with [Tone.js](https://tonejs.github.io/).

## Run it locally

From `SOA/projects/SOA-frontend/`:

```bash
npm install
cp .env.template .env       # algod/indexer config, for wallet + NFPreset features
npm run dev                 # :5173
```

There is no backend to run. The gossip feed is a public relay endpoint, so the
sonifier works as soon as the page loads — press **Start**.

## What it does

- **Live data, not polling** — subscribes to relay gossip, no backend of its own.
- **One synth per transaction type**, filterable down to specific assets,
  apps, accounts, or amount ranges — you design the identity, not the app.
- **Several synth engines** — Synth, MonoSynth, PolySynth, AM and FM — over a
  shared effects chain: filter, delay, a shared convolution reverb bus, vibrato,
  and an LFO with several destinations.
- **Visualizations** — Score, Territory and others render the same traffic
  you're hearing, full-screen, while it plays.
- **Presets** — save and load whole layouts, locally, as a `.json`, or minted
  on-chain as an NFPreset. Loading a shipped preset or an NFPreset puts it in
  the address bar, so copying the URL is all it takes to share it.

There's a how-to guide inside the app, behind the **(i)** beside the title.

## Versioning

SemVer, single-sourced from `SOA/projects/SOA-frontend/package.json` and injected
at build time. To release: bump the version, add a matching entry to
`src/legacy/changelog.js`, commit, then

```bash
git tag -a vX.Y.Z -m "..."
git push origin main --follow-tags   # this also deploys
```

Two things worth knowing before choosing a number:

**The compatibility surface is presets, not code.** Nobody imports this as a
library, so "breaking" means a preset that used to sound right no longer does.
Renaming or repurposing a settings key is MAJOR; adding one with a sensible
default is MINOR. Presets carry `formatVersion` (the shape of the file) and
`appVersion` (what wrote it) so old ones can be routed to old behaviour rather
than silently re-voiced — which matters because **NFPresets are immutable
on-chain** and cannot be re-stamped or migrated after the fact.

**A bump interrupts everyone.** The version drives a card that every returning
user sees once. Docs and tooling changes ride along with the next real release
rather than earning one of their own.

Pre-1.0 while the preset schema is still settling. Reaching 1.0 is a statement
that presets are stable, not that the feature list is finished.

## Stack

AlgoKit workspace · React + Vite frontend · Tone.js audio engine · a thin
gossip-protocol client in `src/services/gossip/`.
