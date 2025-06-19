# The Sound of AVM

## Algorand Transaction Sonifier

In this prototype stage, use Nodely API or connect to your node through a port with an `algod` token that can be found in your node directory. The token is stored in local browser storage.

Start a local server, for example:

```bash
npx http-server .
```

The script polls the pending transactions every 50ms and lets `Tone.js` schedule them to be played.

---

**How to Play**

Start with a defualt preset from the Load Preset menu and play around with the settings. Less is more. Add synths and set the sources as your favorite accounts, ASAs and applications. Create more exciting soundscape by assigning more than one synth to one source but with different sounds. Less is more. Let the `block` synth be the rythm and create a theme, like arbitrage, ora mining, stable coins, memecoins. Save your preset layout, download the json, share with friends.

**UI Elements:**

*   **Top bar buttons:** 
    *   Play/Stop, Record (under construction).
    *   Save/Load preset - saving in local storage and as a .json file to share with friends. 
    *   Aggr/Single Txs (under construction).
    *   Nodely API/Your Node - choose your victim. +Add Synth - add synth.
    
* **MASTER BUS:** simple master controls. If Mute all, it's possible to unmute single synths.
*   **Synth:** Every single synth can be set up with main tx types and/or their subtypes, except stateproof and heartbeat (for now). If only main type is chosen, it will play all txs of that type. If you have one `axfer` synth and one `axfer-assetId`, the latter will only play transfer txs of that asset, while the main `axfer` synth will **exclude** the txs with that asset from it's schedule.
*   **Effects:** The synth has a panel of effects, and they are modulating the signal sequentially, ending with an LFO, which adds a flair of modularity.

---

**Future improvements and considerations**

1.  Transactions come in too fast for `Tone.js`, making it unable to create unique timestamps for every one of them.
    *   Adjust `setTimeout`.
    *   **Aggregation:** Add a chorus/phaser/flanger effect, count transactions in each polling batch, apply an aggregation function instead of individual sounds, let the user control via UI. We have a toggle now for this, but functionality not yet implemented. Considering adding functionality for single synths instead of global.
    *   Ignore missed transactions (current behavior).
2.  `gpu` and Rasterize paint are heavy users in the performance record.
3.  Excessive console logging; consider adding a debugging flag and wrapping log statements.
4. Add logic to detect and filter certified blocks, which will enable granular control of `appl` and inner txs and `hb` tx senders and others that are not accessible in the mempool.
5. Introduce menus where user can pick from a list of popular assets and known applications to initialize those parameters immediately. Consider adding logos as well.
6. Record .wav files and mint them on-chain.
