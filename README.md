# The Sound of AVM

## Algorand Transaction Sonifier

In this prototype stage, let the JavaScript script connect to your node through a port with an `algod` token that can be found in your node directory.

Start a local server, for example:

```bash
npx http-server .
```

The script polls the pending transactions every 50ms and lets `Tone.js` schedule them to be played.

---

**UI Elements:**

*   **Top bar buttons:** Play/Stop (working), others are placeholders.
*   **Bottom:** Store your favorite presets in local storage.

---

## Issues

1.  Transactions come in too fast for `Tone.js`, making it unable to create unique timestamps for every one of them.
    *   Adjust `setTimeout`.
    *   **Aggregation:** Add a chorus/phaser/flanger effect, count transactions in each polling batch, apply an aggregation function instead of individual sounds, let the user control via UI.
    *   Ignore missed transactions (current behavior).
2.  Adding a new synth doesn't add the sound engine to the synth. Fixing this requires refactoring. This is likely not the only area requiring refactoring, so holding off for now.
3.  `gpu` and Rasterize paint are heavy users in the performance record.
4.  Excessive console logging; consider adding a debugging flag and wrapping log statements.
