# The Sound of AVM

A live sonifier for the Algorand mempool. It connects directly to a relay's
gossip WebSocket, decodes signed transactions as they arrive, and plays them
through per-type synths built with [Tone.js](https://tonejs.github.io/).

## Run it locally

From `SOA/projects/SOA-frontend/`, in two terminals:

```bash
npx tsx api-dev-server.ts   # local API server, :3001
npm run dev                 # Vite frontend, :5173 (proxies /api -> :3001)
```

## What it does

- **Live data, not polling** — subscribes to relay gossip, no backend of its own.
- **One synth per transaction type**, filterable down to specific assets,
  apps, accounts, or amount ranges — you design the identity, not the app.
- **Five synth engines** (Synth, MonoSynth, PolySynth, AM, FM) with a shared
  effects chain: filter, delay, a shared convolution reverb bus, vibrato,
  and an LFO with several destinations.
- **Two visualizations** — The Score and The Loom — plus save/load presets
  (local or as a shareable `.json`).

## Stack

AlgoKit workspace · React + Vite frontend · Tone.js audio engine · a thin
gossip-protocol client in `src/services/gossip/`.
