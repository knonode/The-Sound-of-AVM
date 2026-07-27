// The how-to guide, in one place.
//
// This module is the single source of truth for both halves of the guide:
//   - the info modal renders `title` + `body`, and points an <img> at /guide/<id>.png
//   - scripts/capture-guide-shots.mjs reads `selector` + `state` to produce that PNG
// so a renamed section can't leave a stale screenshot behind, and a new section
// can't be forgotten by the capture run.
//
// `selector` null means text-only (no screenshot).
//
// `state` names the page setup the shot needs; the capture script owns the routines:
//   page      - nothing added, just the loaded page
//   default   - one synth on pay / amount (so the parameter area has min+max inputs)
//   axfer     - one synth on axfer / assetid (the ASA name lookup)
//   fm        - the default synth switched to the FM engine, FM tab open
//   mono      - the default synth switched to Mono, Filter Env tab open
//   master    - the Master card, always present
//   presets   - the Load Preset modal, opened
//
// Order matters: it follows the real top-to-bottom order of a synth card, which is
// also the order you build a sound in.
export const GUIDE_SECTIONS = [
  {
    id: 'intro',
    title: 'What this is',
    selector: null,
    state: 'page',
    body: `
      <p>Algorand transactions arrive constantly. This app listens to them as they show
      up in the mempool — before they're settled — and turns them into sound. Nothing is
      pre-recorded; if you hear a note, a transaction just happened.</p>
      <p>You build the instrument yourself. Each <strong>synth</strong> is a pair: a rule
      about which transactions it cares about, and a sound it makes when one shows up.
      Add a few synths with different rules and the network starts playing them.</p>
      <p>A synth is built like a ladder — you work down it, from <em>which transactions</em>
      at the top to <em>how the sound moves</em> at the bottom. The rest of this guide
      follows that ladder rung by rung.</p>
    `,
  },

  {
    id: '01-topbar',
    title: 'Getting a sound out of it',
    selector: '.top-bar',
    state: 'page',
    viewport: 900, // full-width bar: shot narrow so it stays legible in the modal
    body: `
      <p><strong>Start</strong> connects to the live mempool feed and begins playing.
      <strong>Stop</strong> disconnects. The spacebar does the same thing from anywhere
      on the page, as long as you're not typing in a box.</p>
      <p>Browsers won't let a page make noise until you've interacted with it, so the
      first Start is also what unlocks the audio. If it's silent, press Start again.</p>
      <p><strong>Save Preset</strong> and <strong>Load Preset</strong> keep whole layouts
      — every synth and every setting. <strong>Wallet</strong> is only needed for minting
      a preset on-chain as an NFPreset. <strong>Record</strong> isn't wired up yet.</p>
      <p>Quickest way to hear something: press <strong>Load Preset</strong>, pick
      <em>vanilla</em>, then press <strong>Start</strong>.</p>
    `,
  },

  {
    id: '02-actions-bar',
    title: 'The second row',
    selector: '.actions-bar',
    state: 'page',
    viewport: 900, // full-width bar: shot narrow so it stays legible in the modal
    body: `
      <p>The named buttons on the left open <strong>visualizations</strong> — full-screen
      pictures of the same data you're hearing. More on those below.</p>
      <p><strong>+ Add Synth</strong> on the right adds an empty synth card. That's where
      you start when building your own.</p>
      <p><strong>gossip:</strong> is the connection light — <em>idle</em> before you
      start, <em>open</em> when transactions are flowing.</p>
      <p><strong>Mode</strong> decides what happens when one synth is being triggered
      faster than the cap beside it (default 10 hits per second). <em>Single</em> drops
      the overflow. <em>Aggr</em> collapses it into one louder, longer hit, so a burst
      sounds like a burst instead of a machine gun.</p>
      <p><strong>stalls</strong> and <strong>load</strong> are temporary diagnostics for
      testing — they measure whether your machine is keeping up, and don't affect sound.</p>
    `,
  },

  {
    id: '03-synth-card',
    title: 'One synth, top to bottom',
    selector: '.mini-synth:not(.master-synth)',
    state: 'default',
    body: `
      <p>This is a single synth. The card is colour-coded by the transaction type it
      listens to, so a busy layout stays readable.</p>
      <p>Everything below is one rung of this card, in the order it appears. You don't
      have to touch all of it — pick a type and a subtype and you already have a working
      sound. The rest is shaping.</p>
      <p>The strip of segments down the left is a <strong>level meter</strong>: it shows
      how loud this synth is playing right now. If the top segments light up red, it's
      clipping and wants less volume.</p>
    `,
  },

  {
    id: '04-type',
    title: 'Rung 1 — transaction type',
    selector: '.mini-synth:not(.master-synth) .synth-header',
    state: 'default',
    body: `
      <p>The first dropdown (<strong>Type</strong>) is the big choice: which kind of
      Algorand transaction this synth listens for.</p>
      <ul>
        <li><strong>pay</strong> — plain ALGO payments</li>
        <li><strong>axfer</strong> — asset (ASA) transfers</li>
        <li><strong>appl</strong> — smart contract calls</li>
        <li><strong>acfg</strong> — assets being created, reconfigured or destroyed</li>
        <li><strong>keyreg</strong> — nodes registering online or offline for consensus</li>
        <li><strong>afrz</strong> — assets being frozen or unfrozen</li>
        <li><strong>stpf</strong> — state proofs</li>
        <li><strong>hb</strong> — heartbeats</li>
        <li><strong>group</strong> — grouped transactions that travel together, e.g. a swap</li>
        <li><strong>block</strong> — fires once per block instead of per transaction</li>
      </ul>
      <p>The rest of the header: the <strong>dot on the left</strong> flashes on every
      hit, and you can <strong>click it to audition the sound</strong> without waiting for
      a matching transaction — the fastest way to design. The
      <strong>speaker</strong> mutes this synth, and <strong>×</strong> removes it.</p>
    `,
  },

  {
    id: '05-params',
    title: 'Rung 2 — subtype, and rung 3 — the filter',
    selector: '.mini-synth:not(.master-synth) .parameter-area',
    state: 'default',
    body: `
      <p><strong>Sub</strong>, the second dropdown in the header, narrows the type down to
      what you actually care about. A <em>pay</em> synth can listen to the
      <em>amount</em>, the <em>sender</em> or the <em>receiver</em>. An <em>axfer</em>
      synth adds <em>assetid</em>, <em>opt-in</em>, <em>opt-out</em> and
      <em>clawback</em>.</p>
      <p>Whatever you pick then decides what appears in this box, and that's your filter:</p>
      <ul>
        <li><strong>Min</strong> and <strong>Max</strong> for anything with a range, like an amount or a
        group size. Leave them empty to accept everything.</li>
        <li><strong>An address box</strong> for the sender and receiver subtypes — only that
        account triggers the sound.</li>
        <li><strong>An asset box</strong> that searches by name as well as by ID, so you
        can type <em>USDC</em> instead of looking the number up.</li>
        <li><strong>Label</strong>, an optional name for your own benefit, so you can
        remember what a filtered synth was for.</li>
        <li>Some subtypes need no filter at all and say so — <em>freeze</em> and
        <em>heartbeat</em> either happened or they didn't.</li>
      </ul>
      <p>Two types show a live readout here instead of a filter: <em>stpf</em> counts down
      the rounds to the next state proof, and <em>block</em> shows the current round.</p>
      <p>The narrower the filter, the rarer the sound. A synth pinned to one address may
      stay silent for a long time — that can be exactly the point.</p>
    `,
  },

  {
    id: '05b-asset-search',
    title: 'Filtering by asset, without knowing the number',
    selector: '.mini-synth:not(.master-synth) .parameter-area',
    state: 'axfer',
    body: `
      <p>Worth calling out because it's easy to miss: anywhere an asset is asked for, the
      box searches <em>by name</em>. Start typing <em>USDC</em> and pick it from the list
      — no need to go and look the ID up.</p>
      <p>This is how you make a synth that only sounds when one particular token moves.
      Pair it with <em>group</em> &rarr; <em>asset</em> instead of <em>axfer</em> and you'll catch it
      being swapped on a DEX, too.</p>
    `,
  },

  {
    id: '06-engine',
    title: 'Rung 4 — the engine',
    selector: '.mini-synth:not(.master-synth) .engine-section',
    state: 'default',
    body: `
      <p>Now the sound half of the card. The engine is the kind of instrument underneath
      everything else, and it's worth choosing before you tune anything, because
      switching it rebuilds the voice and resets the tabs further down.</p>
      <ul>
        <li><strong>Synth</strong> — one voice, one note at a time. A new hit cuts off the
        one before it. Tight and percussive when things get busy.</li>
        <li><strong>Mono</strong> — also one voice, but with its own filter and filter
        envelope, so notes can open up and close down as they sound. This is the one that
        gets you a bass or an acid line.</li>
        <li><strong>Poly</strong> — layered voices that overlap instead of cutting each
        other off. The default, and the right choice for pads and chords.</li>
        <li><strong>AM</strong> — amplitude modulation. Adds a metallic edge.</li>
        <li><strong>FM</strong> — frequency modulation. Bell-like at low settings, harsh
        and clangorous when pushed.</li>
      </ul>
    `,
  },

  {
    id: '07-volume',
    title: 'Rung 5 — volume and pan',
    selector: '.mini-synth:not(.master-synth) .volume-section',
    state: 'default',
    body: `
      <p><strong>Volume</strong> in decibels, <strong>Pan</strong> from full left to full
      right. Spreading synths across the stereo field is the single easiest way to keep a
      busy layout intelligible.</p>
      <p>Every number on the card works two ways: drag the slider, or click the number
      and type a value. Pan accepts <em>25L</em>, <em>25R</em> and <em>C</em> as well as
      plain numbers.</p>
    `,
  },

  {
    id: '08-base-note',
    title: 'Rung 6 — base note',
    selector: '.mini-synth:not(.master-synth) .base-note-section',
    state: 'default',
    body: `
      <p>The pitch this synth plays. <strong>←</strong> and <strong>→</strong> move by one
      semitone, <strong>Oct-</strong> and <strong>Oct+</strong> by a whole octave.</p>
      <p>This is where a layout becomes music rather than noise. Give your synths notes
      from the same chord and whatever the network does will sound intentional. Put the
      busiest transaction type low and the rarest one high, and you get bass and melody
      for free.</p>
    `,
  },

  {
    id: '09-sequencer',
    title: 'Rung 7 — the sequencer',
    selector: '.mini-synth:not(.master-synth) .sequencer-section',
    state: 'default',
    body: `
      <p>Eight steps, each one a number of semitones away from the base note. Every time
      this synth plays it takes the next step, then loops back to the first.</p>
      <p>The light under a step shows where it currently is. All zeros means every hit is
      the same note. Try <em>0, 0, 7, 0</em> for something that walks, or <em>0, 12</em>
      for an octave bounce.</p>
      <p>Because it advances on transactions rather than on a clock, the pattern moves at
      whatever speed the network is going. Busy network, fast riff.</p>
    `,
  },

  {
    id: '10-gate',
    title: 'Rung 8 — gate time',
    selector: '.mini-synth:not(.master-synth) .gate-section',
    state: 'default',
    body: `
      <p>How long each note is held down, in seconds — from a 10-millisecond click up to
      20 seconds.</p>
      <p>Short gates give you clicks and plucks. Long gates on a frequently-triggered
      synth give you overlapping drones, especially on the Poly engine. This interacts
      with the envelope below: a gate shorter than the attack means the note never gets
      to full volume.</p>
    `,
  },

  {
    id: '11-adsr',
    title: 'Rung 9 — the envelope (ADSR)',
    selector: '.mini-synth:not(.master-synth) .adsr-section',
    state: 'default',
    body: `
      <p>The shape of a single note over time. This is what makes a sound feel plucked,
      or blown, or bowed.</p>
      <ul>
        <li><strong>A</strong>ttack — seconds to reach full level. Near zero is a hard
        hit; a second or more fades in.</li>
        <li><strong>D</strong>ecay — seconds from that peak down to the sustain level.</li>
        <li><strong>S</strong>ustain — the level it holds at while the note lasts.</li>
        <li><strong>R</strong>elease — seconds to fade away after the note ends.</li>
      </ul>
      <p>Plucked string: fast attack, quick decay, low sustain. Pad: slow attack, high
      sustain, long release.</p>
      <p>The tabs along the top of this section switch between envelope pages. Which tabs
      you get depends on the engine you chose.</p>
    `,
  },

  {
    id: '12-extras',
    title: 'Rung 9b — detune, AM and FM',
    selector: '.mini-synth:not(.master-synth) .adsr-section',
    state: 'fm',
    body: `
      <p>The second tab holds the tuning and modulation controls. Its name changes with
      the engine.</p>
      <p><strong>Detune</strong> (all engines) shifts pitch in cents — hundredths of a
      semitone, up to a full octave either way. Small amounts are for beating two synths
      gently against each other; it isn't a substitute for the base note.</p>
      <p>On <strong>AM</strong> and <strong>FM</strong> you also get
      <strong>Harm.</strong> (harmonicity), the ratio between the two oscillators: 1 is
      unison, 2 is an octave up, and non-whole numbers get inharmonic and bell-like.</p>
      <p><strong>FM</strong> adds <strong>Mod.</strong> (modulation index) — how hard the
      modulator bends the carrier. Low is gentle, high goes metallic and aggressive. This
      is the main character control for FM sounds, so it's the one to sweep first.</p>
    `,
  },

  {
    id: '13-filter-env',
    title: 'Rung 9c — filter envelope (Mono only)',
    selector: '.mini-synth:not(.master-synth) .adsr-section',
    state: 'mono',
    body: `
      <p>Only the <strong>Mono</strong> engine has this third tab. It's a second ADSR, but
      instead of shaping volume it shapes <em>brightness</em> — sweeping the filter open
      and closed over the life of each note.</p>
      <p>Fast attack and short decay is the classic plucky, resonant bass. Slow attack
      makes each note bloom open. It's the biggest reason to pick Mono over the others.</p>
    `,
  },

  {
    id: '14-waveform',
    title: 'Rung 10 — waveform and cutoff',
    selector: '.mini-synth:not(.master-synth) .waveform-section',
    state: 'default',
    body: `
      <p><strong>Waveform</strong> is the raw tone before anything shapes it:</p>
      <ul>
        <li><strong>Sine</strong> — pure and soft, no harmonics.</li>
        <li><strong>Triangle</strong> — soft but with a little edge.</li>
        <li><strong>Square</strong> — hollow and reedy.</li>
        <li><strong>Sawtooth</strong> — bright and buzzy, the brassiest of the four.</li>
        <li>The <strong>Fat</strong> versions stack several detuned copies for a thicker,
        wider sound. They cost more to play, so go easy on a busy layout.</li>
      </ul>
      <p><strong>Cutoff</strong> is a low-pass filter: turn it down and the highs go away,
      leaving something duller and more distant. Rolling the cutoff off on the
      high-traffic synths and leaving the rare ones bright is a good way to stop
      everything competing.</p>
    `,
  },

  {
    id: '15-delay',
    title: 'Rung 11 — delay',
    selector: '.mini-synth:not(.master-synth) .delay-section',
    state: 'default',
    body: `
      <p>An echo. <strong>Delay Time</strong> is the gap before the repeat,
      <strong>Feedback</strong> is how many times it repeats, and <strong>Delay Wet</strong>
      is how much of it you hear — at zero the effect is disconnected entirely.</p>
      <p>High feedback with a short delay time turns single hits into a texture, which can
      make a rare transaction type feel like an event.</p>
    `,
  },

  {
    id: '16-reverb',
    title: 'Rung 12 — reverb',
    selector: '.mini-synth:not(.master-synth) .reverb-section',
    state: 'default',
    body: `
      <p><strong>Reverb Wet</strong> is how much of this synth gets sent into the reverb.
      Zero disconnects it.</p>
      <p><strong>Room Size</strong> is worth knowing about: there is <em>one shared room</em>
      for the whole app, so changing it here changes it for every synth. That's
      deliberate — it's what makes all the parts sound like they're in the same place.
      Send amounts are per-synth; the room is not.</p>
    `,
  },

  {
    id: '17-lfo',
    title: 'Rung 13 — the LFO',
    selector: '.mini-synth:not(.master-synth) .lfo-section',
    state: 'default',
    body: `
      <p>The bottom rung, and the one that makes a sound move on its own. An LFO is a slow
      wave that wobbles something else, continuously, whether or not a transaction just
      arrived.</p>
      <p>Set <strong>Dest.</strong> first — it's off until you do:</p>
      <ul>
        <li><strong>Vibrato</strong> — wobbles the pitch.</li>
        <li><strong>Volume</strong> — pulses the level, a tremolo.</li>
        <li><strong>Cutoff</strong> — sweeps the brightness back and forth.</li>
        <li><strong>Delay Time</strong> — smears the echo around, for something seasick.</li>
      </ul>
      <p><strong>Rate</strong> is the speed, from one cycle every hundred seconds up to
      30 a second. <strong>Depth</strong> is how far it moves, and
      <strong>Waveform</strong> is the shape of the movement — Sine glides, Square jumps
      between two values, Sawtooth ramps and snaps back.</p>
      <p>Very slow and very shallow is the useful setting nobody tries first: it stops a
      long drone from sounding like a dead loop.</p>
    `,
  },

  {
    id: '18-master',
    title: 'The Master card',
    selector: '.master-synth',
    state: 'master',
    body: `
      <p>Master is always there, can't be removed, and doesn't listen to transactions.
      Everything else runs through it, so it's where you fix the overall balance.</p>
      <ul>
        <li><strong>Master Volume</strong> — everything at once. Its speaker button mutes
        the whole app; individual synth mutes still work on top of it.</li>
        <li><strong>Compressor</strong> — evens out the difference between quiet stretches
        and bursts. <em>Threshold</em> is the level where it starts working,
        <em>Ratio</em> is how firmly. Useful here, because network traffic is spiky by
        nature.</li>
        <li><strong>3-Band EQ</strong> — cut or boost Low, Mid and High by up to 12 dB.</li>
        <li><strong>Limiter</strong> — a ceiling that catches peaks. Leave it on; it's
        what stops a sudden flood from clipping.</li>
      </ul>
      <p>The two meters are left and right channels. If they're pinned at the top, pull
      the master volume down rather than reaching for the limiter.</p>
    `,
  },

  {
    id: '19-visualizations',
    title: 'Visualizations',
    selector: '.viz-bar',
    state: 'page',
    viewport: 900, // full-width bar: shot narrow so it stays legible in the modal
    body: `
      <p>Each of these opens full-screen over the app, drawing the same transactions
      you're listening to. Click anywhere, or press <strong>Escape</strong>, to come back.</p>
      <p>The bar above is the current set — it changes as new ones are built, and greyed-out
      names are the ones still being worked on. Each takes a different angle on the same
      stream: <strong>Score</strong> lays transactions out as a scrolling graphic score,
      while <strong>Territory</strong> gives every one of them a share of the screen and
      lets new arrivals squeeze the standing ground aside.</p>
      <p>They're worth opening while a busy preset is playing — the same burst that
      crowds the sound also crowds the picture, which makes it easier to hear what you're
      looking at.</p>
    `,
  },

  {
    id: '20-presets',
    title: 'Saving, loading and sharing',
    selector: '#load-preset-modal .modal-content',
    state: 'presets',
    body: `
      <p>A preset is a whole layout: every synth, every filter, every setting.</p>
      <p><strong>Load Preset</strong> lists the ones shipped with the app on top, then
      anything you've saved yourself. The <strong>×</strong> on the right of a row deletes
      it — greyed out on the shipped presets, since those aren't yours to remove.</p>
      <p>Under <strong>Save Preset</strong>, <em>Save</em> overwrites what you have
      loaded, <em>Save As...</em> makes a new one, and <em>Save a Copy</em> leaves the
      original alone. There's also a tickbox to download the preset as a
      <code>.json</code> file, and a section for minting it on-chain as an
      <strong>NFPreset</strong>, which needs a connected wallet.</p>
      <p>To share: load a shipped preset or an NFPreset, and the address bar updates to
      match. Copy the URL and whoever opens it lands on the same layout. Presets saved
      only in your own browser have no URL — copy them out as <code>.json</code>, or mint
      them, to pass them on.</p>
    `,
  },
]
