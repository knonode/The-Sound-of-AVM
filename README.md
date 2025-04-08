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
*   **Bottom:** Store your favorite presets in local storage or pick an existing one.
*   **Synth:** Every single synth can be set up with main tx types and/or their subtypes, except stateproof and heartbeat (for now). If only main type is chosen, it will play all txs of that type. If you have one `axfer` synth and one `axfer-assetId`, the latter will only play transfer txs of that asset, while the main `axfer` synth will **exclude** the txs with that asset from it's schedule.
*   **Effects** The synth has a panel of effects, and they are modulating the signal sequentially, ending with an LFO, which adds a flair of modularity.

---

**Future improvements and considerations**

1.  Transactions come in too fast for `Tone.js`, making it unable to create unique timestamps for every one of them.
    *   Adjust `setTimeout`.
    *   **Aggregation:** Add a chorus/phaser/flanger effect, count transactions in each polling batch, apply an aggregation function instead of individual sounds, let the user control via UI.
    *   Ignore missed transactions (current behavior).
2.  `gpu` and Rasterize paint are heavy users in the performance record.
3.  Excessive console logging; consider adding a debugging flag and wrapping log statements.
4. Add logic to detect and filter certified blocks, which will enable granular control of `appl` and inner txs and `hb` tx senders and others that are not accessible in the mempool.
5. Introduce menus where user can pick from a list of popular assets and known applications to initialize those parameters immediately. Consider adding logos as well.
6. Save presets needs rethinking.
