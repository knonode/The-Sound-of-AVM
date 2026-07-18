/*
 * tone-synthesis.js - Core Tone.js audio synthesis engine
 * Separated from UI logic for better modularity and reusability
 */

import * as Tone from 'tone';

// A ~40ms output buffer: a glitch only happens when the renderer misses a
// delivery deadline, and a deeper buffer makes every deadline forgiving —
// absorbing both our per-note construction spikes and OS preemption blips.
// Costs constant tx-arrival -> sound latency, which a mempool sonifier
// doesn't feel; spacing BETWEEN txs is unaffected. Must run before any
// node is created so the whole graph lands on this context.
Tone.setContext(new Tone.Context({ latencyHint: 0.04 }));

// Tone.js synth setup - Core audio state
let synthsInitialized = false;
let masterEQ, masterCompressor, masterLimiter;
// One reverb engine for the whole app: per-synth Freeverbs saturated the
// audio thread (~8% each, rendering even in silence). Synth reverb-wet
// knobs are send amounts into this bus; room size is global.
let sharedReverb = null;
let masterSplit, masterMeterL, masterMeterR;
let isMasterMuted = false;
let masterVolumeBeforeMute = -3.0;

let iOSMediaUnlocked = false;
async function unlockIOSAudioOnce() {
  if (iOSMediaUnlocked) return;
  try {
    const el = document.createElement('audio');
    el.src =
      'data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACcQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='; // very short silence
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    await el.play().catch(() => {});
    el.pause();
    iOSMediaUnlocked = true;
  } catch (e) {
    console.warn('iOS media unlock failed', e);
  }
}

// Core synthesis functions

// Scales a 0-100 depth value to an appropriate modulation range for a target
function scaleLfoDepth(destination, depthPercent, baseValue) {
    const depth = depthPercent / 100; // Convert 0-100 to 0-1

    switch(destination) {
        case 'pitch':
            // Modulate pitch by +/- 1 octave (1200 cents) max? Let's start smaller.
            // Modulate by +/- 2 semitones (200 cents)
            const pitchModRangeCents = 200;
            return pitchModRangeCents * depth;
        case 'volume':
            // Modulate volume. Base is dB. Let's try +/- 12 dB range?
             // Base volume is often negative, modulating around it.
             // Max mod amount = 12 dB
            const volModRangeDb = 12;
            return volModRangeDb * depth;
        case 'delayTime':
            // Modulate delay time. Base is seconds (e.g., 0 to 1).
            // Let's modulate +/- 50% of max delay time (1s)? So +/- 0.5s
            // Or modulate relative to current delay time? Let's try fixed range first.
            const delayModRangeSec = 0.1; // Reduced from 0.25 to 0.1 seconds max
             return delayModRangeSec * depth;
        default:
            return 0; // No modulation
    }
}

// Helper function to connect/disconnect LFO based on settings
function connectLFO(instance) {
    if (!instance?.toneObjects?.lfo || !instance.toneObjects.synth || !instance.toneObjects.delay) {
        // console.warn(`LFO DEBUG (${instance.id}): Cannot connect LFO, Tone objects not ready.`);
        return;
    }

    const { lfo, synth, delay, vibrato } = instance.toneObjects;
    const { destination, depth } = instance.settings.lfo;
    const { baseNote } = instance.settings; // Needed for pitch base freq
    const { volume: baseVolume } = instance.settings; // Needed for volume base level
    const { time: baseDelayTime } = instance.settings.delay; // Needed for delay base time

    // console.log(`LFO DEBUG (${instance.id}): connectLFO called. Dest: ${destination}, Depth: ${depth}, BaseVol: ${baseVolume}`); // <<< ADDED LOG

    // --- Disconnect from all potential targets first ---
    // console.log(`LFO DEBUG (${instance.id}): Attempting to disconnect LFO from previous targets...`); // <<< ADDED LOG
    try {
         // Simply call disconnect - it's safe if not connected
         lfo.disconnect(synth.volume);
         lfo.disconnect(delay.delayTime);
         // Bypass the vibrato stage; the pitch branch re-enables it
         vibrato?.set({ wet: 0 });
         //console.log(`LFO DEBUG (${instance.id}): Disconnect successful (or was not connected).`); // <<< MODIFIED LOG
    } catch (e) {
        // Log error IF disconnect itself fails for some reason
        console.error(`LFO DEBUG (${instance.id}): Error during LFO disconnect call:`, e); // <<< MODIFIED LOG
    }

    // --- Set amplitude based on depth (if depth is 0, amplitude is 0) ---
    const scaledModulationAmount = scaleLfoDepth(destination, depth, 0); // Base value isn't strictly needed for range scaling here

    // The LFO's amplitude controls the *amount* of modulation.
    // The LFO's min/max determine the *range* it oscillates over relative to the target's base value.
    const targetAmplitude = depth > 0 ? 1 : 0; // <<< RENAMED for clarity
    // console.log(`LFO DEBUG (${instance.id}): Setting LFO amplitude to: ${targetAmplitude}`); // <<< ADDED LOG
    lfo.amplitude.value = targetAmplitude;

    if (depth === 0 || destination === 'none') {
        // console.log(`LFO DEBUG (${instance.id}): LFO inactive (Depth 0 or Dest None). Resetting min/max.`);
        lfo.min = 0; // Reset min/max when inactive
        lfo.max = 0;
        return; // Exit if no destination or zero depth
    }

    // --- Connect to the new target and set min/max based on scaled depth ---
    // console.log(`LFO DEBUG (${instance.id}): Preparing LFO for ${destination}. ScaledMod: ${scaledModulationAmount.toFixed(2)}`); // <<< MODIFIED LOG

    let targetParam = null;
    let targetParamName = '';
    let targetValueBefore;

    try {
        switch(destination) {
            case 'pitch':
                // Vibrato stage instead of a direct oscillator connection
                if (vibrato) {
                    vibrato.set({
                        frequency: instance.settings.lfo.rate,
                        depth: Math.min(1, depth / 100),
                        wet: 1
                    });
                }
                return; // handled entirely by the vibrato node
            case 'volume':
                targetParam = synth.volume;
                targetParamName = 'synth.volume';
                lfo.min = baseVolume - scaledModulationAmount;
                lfo.max = baseVolume + scaledModulationAmount;
                break;
            case 'delayTime':
                targetParam = delay.delayTime;
                targetParamName = 'delay.delayTime';
                // <<< SAFER DELAY TIME BOUNDS >>>
                const safeMinDelay = Math.max(0.01, baseDelayTime * 0.1); // Never below 10ms, and not below 10% of base
                const safeMaxDelay = Math.min(1.0, baseDelayTime * 3);     // Never above 1s, and not above 3x base
                lfo.min = Math.max(safeMinDelay, baseDelayTime - (scaledModulationAmount * 0.5)); // Reduce modulation amount
                lfo.max = Math.min(safeMaxDelay, baseDelayTime + (scaledModulationAmount * 0.5)); // Reduce modulation amount

                break;
        }

        if (targetParam) {
            try {
                targetValueBefore = targetParam.value;
            } catch (readError) {
                 console.error(`LFO DEBUG (${instance.id}): Error reading target value BEFORE connect:`, readError);
                 targetValueBefore = 'Error reading value';
            }

            // Connect only if valid target and not muted (for volume)
            if (destination === 'volume' && instance.settings.muted) {
                // Synth muted, skip LFO connect to volume
            } else {
                lfo.connect(targetParam);

                // <<< ADDED LOG: Schedule check of value AFTER connect >>>
                Tone.Draw.schedule(() => {
                    try {
                        const targetValueAfter = targetParam.value;

                    } catch (readError) {
                        console.error(`LFO DEBUG (${instance.id}): Error reading target value AFTER connect:`, readError);
                    }
                }, Tone.now() + 0.05); // Check slightly after connection
                // <<< END ADDED LOG >>>
            }
        } else {
            // No valid LFO target determined
        }

    } catch (error) {
         console.error(`LFO DEBUG (${instance.id}): Error setting up/connecting LFO for ${destination}:`, error); // <<< MODIFIED LOG
    }
}

// Initialize global Tone.js audio context and master FX chain
async function initAudio() {
  if (synthsInitialized) return; // Prevent re-running if already initialized globally


  try {
    await unlockIOSAudioOnce();   // ensure iOS is unlocked before Tone.start()
    await Tone.start();

      // <<< NEW: Initialize Master FX Chain >>>
      masterEQ = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
      masterCompressor = new Tone.Compressor({ threshold: -24, ratio: 4 });
      masterLimiter = new Tone.Limiter(-2);

      // Connect the master chain: EQ -> Compressor -> Limiter -> Final Output
      masterEQ.connect(masterCompressor);
      masterCompressor.connect(masterLimiter);
      masterLimiter.toDestination(); // Final connection to speakers

      // Shared reverb bus (wet 1 = pure effect; the dry path goes straight
      // to masterEQ, so this only ever carries the reverb tail)
      sharedReverb = new Tone.Freeverb({ roomSize: 0.7, wet: 1 });
      sharedReverb.connect(masterEQ);

      // Read-only stereo tap for the master ladder meters
      masterSplit = new Tone.Split();
      masterMeterL = new Tone.Meter({ smoothing: 0.8 });
      masterMeterR = new Tone.Meter({ smoothing: 0.8 });
      masterLimiter.connect(masterSplit);
      masterSplit.connect(masterMeterL, 0, 0);
      masterSplit.connect(masterMeterR, 1, 0);

      // Set initial master volume
      if (Tone.Destination.volume) {
          Tone.Destination.volume.value = -3.0;
      }

      // <<< END NEW >>>

      synthsInitialized = true;
  } catch (error) {
      console.error("Failed to start Tone.js Audio Context:", error);
      throw error;
  }
}

// 'fat' oscillator types get a detuned unison stack
function buildOscillatorOptions(oscillator) {
    const type = oscillator?.type ?? 'sine';
    if (type.startsWith('fat')) {
        return { type, count: 3, spread: 20 };
    }
    return { type };
}

// Create Tone.js objects for a single synth instance
async function initializeToneForInstance(instance) {
    // The master card is a mixer strip, not an instrument: its audio is the
    // module-level master chain (EQ -> compressor -> limiter). Building a
    // voice rack for it would render silently forever.
    if (instance.id === 'master') return;
    // Ensure audio context is started before creating nodes
    if (!synthsInitialized) {
        console.warn("Audio context not started, attempting start before initializing instance:", instance.id);
        await initAudio(); // This will call Tone.start() if needed
        if (!synthsInitialized) {
             console.error("Failed to start audio context for instance initialization.");
             return; // Exit if context failed
        }
    }

    if (!instance || instance.toneObjects) {
        return; // Already initialized or instance not found
    }

    try {
        const settings = instance.settings;
        const delay = new Tone.FeedbackDelay({
            delayTime: settings.delay.time,
            feedback: settings.delay.feedback,
            wet: settings.delay.wet
        });
        // Send into the shared reverb bus; gain = the synth's reverb wet.
        // Room size is global — a preset's roomSize values apply last-wins.
        const reverbSend = new Tone.Gain(settings.reverb?.wet ?? 0);
        if (sharedReverb) {
            reverbSend.connect(sharedReverb);
            const desiredRoomSize = (typeof settings.reverb?.roomSize === 'number')
                ? settings.reverb.roomSize
                : Math.max(0.05, Math.min(0.95, ((settings.reverb?.decay ?? 1.5) / 10)));
            sharedReverb.roomSize.value = desiredRoomSize;
        }

        // Polyphonic voice: overlapping transactions layer instead of
        // cutting each other off.
        // Envelope floor: an attack/release at (or near) zero is a waveform
        // discontinuity — audible as a click at any volume. 5ms/30ms ramps
        // are below the threshold of sounding "softer" but remove the click.
        const env = settings.envelope || {};
        const synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: buildOscillatorOptions(settings.oscillator),
            envelope: {
                ...env,
                attack: Math.max(0.005, env.attack ?? 0.005),
                release: Math.max(0.03, env.release ?? 0.03)
            }
        });
        synth.maxPolyphony = 12;
        synth.volume.value = settings.muted ? -Infinity : settings.volume;

        // Pitch LFO stage (PolySynth has no per-voice frequency param, so
        // pitch modulation is a Vibrato effect; wet 0 = bypass).
        const vibrato = new Tone.Vibrato({
            frequency: settings.lfo.rate,
            depth: 0,
            wet: 0
        });

        // Per-voice lowpass — the subtractive stage
        const filter = new Tone.Filter({
            type: 'lowpass',
            frequency: settings.filter?.cutoff ?? 20000,
            rolloff: -12,
            Q: 1
        });

        const panner = new Tone.Panner(settings.pan ?? 0);

        // Read-only level tap for this voice's ladder meter
        const meter = new Tone.Meter({ smoothing: 0.8 });
        panner.connect(meter);

        const lfo = new Tone.LFO({
            frequency: settings.lfo.rate,
            type: settings.lfo.waveform,
            min: -1,
            max: 1,
            amplitude: 0
        }).start();

        // Chain: PolySynth -> Vibrato -> Filter -> [Delay] -> Panner -> Master
        //                                          Panner -> [send] -> shared reverb bus
        // Delay/send only join the graph while their wet > 0 (see rewireFxChain).
        synth.connect(vibrato);
        vibrato.connect(filter);
        if (masterEQ) {
            panner.connect(masterEQ);
        } else {
            panner.toDestination();
        }

        // Store references on the instance
        instance.toneObjects = { synth, vibrato, filter, panner, delay, reverbSend, lfo, meter };
        rewireFxChain(instance.toneObjects, settings);

        // Connect LFO based on initial settings
        connectLFO(instance);

    } catch (error) {
        console.error(`Failed to initialize Tone.js objects for instance ${instance.id}:`, error);
        instance.toneObjects = null;
    }
}

// Wire filter -> [delay] -> panner, plus a post-pan send into the shared
// reverb bus when reverb wet > 0. A connected effect renders every quantum
// even in silence, so bypass must mean disconnection — an unreachable node
// costs nothing. No-ops unless the on/off state actually changed (avoids
// mid-signal disconnect glitches on ordinary wet-slider moves).
function rewireFxChain(toneObjects, settings) {
    const { filter, delay, panner, reverbSend } = toneObjects || {};
    if (!filter || !delay || !panner || !reverbSend) return;
    const delayOn = (settings.delay?.wet ?? 0) > 0;
    const reverbOn = (settings.reverb?.wet ?? 0) > 0;
    const prev = toneObjects._fxWiring;
    if (prev && prev.delayOn === delayOn && prev.reverbOn === reverbOn) return;
    if (!prev || prev.delayOn !== delayOn) {
        filter.disconnect();
        delay.disconnect();
        let head = filter;
        if (delayOn) { head.connect(delay); head = delay; }
        head.connect(panner);
    }
    if (reverbOn && !prev?.reverbOn) panner.connect(reverbSend);
    if (!reverbOn && prev?.reverbOn) {
        try { panner.disconnect(reverbSend); } catch { /* edge already gone */ }
    }
    toneObjects._fxWiring = { delayOn, reverbOn };
}

// Room size is a property of the shared bus — any synth's slider moves it
function updateSharedReverbRoomSize(value) {
    if (!sharedReverb) return;
    const size = Math.max(0, Math.min(1, value));
    if (sharedReverb.roomSize.rampTo) {
        sharedReverb.roomSize.rampTo(size, 0.02);
    } else {
        sharedReverb.roomSize.value = size;
    }
}

// Dispose of Tone.js objects for a synth instance
function disposeSynth(instanceId, activeSynths) {
    const instance = activeSynths.find(s => s.id === instanceId);
    if (!instance || !instance.toneObjects) {
         // console.log(`No Tone.js objects to dispose for instance ${instanceId}`);
         return; // Nothing to dispose
    }



    try {
        // Check dispose method exists before calling
        instance.toneObjects.lfo?.dispose();
        instance.toneObjects.synth?.dispose();
        instance.toneObjects.vibrato?.dispose();
        instance.toneObjects.filter?.dispose();
        instance.toneObjects.panner?.dispose();
        instance.toneObjects.delay?.dispose();
        instance.toneObjects.reverbSend?.dispose();
        instance.toneObjects.meter?.dispose();
    } catch (error) {
        console.error(`Error disposing Tone.js objects for ${instanceId}:`, error);
    }
    instance.toneObjects = null; // Clear the reference after disposal
}

// Play a transaction sound using the synthesis engine
function playTransactionSound(instance, timeOffset = 0, opts = {}) {
  const { id, settings, toneObjects } = instance;

  // Check if synth should be muted (either by user or by master)
  const isMuted = settings.muted || (settings.mutedByMaster && isMasterMuted);

  if (!toneObjects || isMuted) {
    return; // Don't play if muted or audio objects not ready
  }

  // --- SEQUENCER LOGIC ---
  // The UI wrapper advances the step and passes the offset; only run our
  // own sequencer when called standalone (otherwise the step advances twice
  // and every other step is skipped).
  let sequenceOffset;
  if (opts.sequenceOffset !== undefined) {
    sequenceOffset = opts.sequenceOffset;
  } else {
    const currentStep = settings.currentStepIndex ?? 0;
    const sequence = settings.sequence || [0, 0, 0, 0, 0, 0, 0, 0];
    sequenceOffset = sequence[currentStep];
    instance.settings.currentStepIndex = (currentStep + 1) % 8;
  }

  // --- Note Calculation ---
  const baseNote = settings.baseNote;
  const pitchShift = settings.pitch;
  const note = Tone.Frequency(baseNote).transpose(pitchShift + sequenceOffset);
  const duration = settings.noteDuration * (opts.durationScale ?? 1);
  const velocity = opts.velocity ?? (0.7 + (Math.random() * 0.3)); // Random velocity



  try {
    // Gossip hands us clumps: many txs can land within one relay batch.
    // Spacing clumped triggers >= 30ms apart bounds how many graph
    // mutations (oscillator builds) hit a single render quantum and stops
    // phase-aligned onsets summing into a thump. Naturally spaced arrivals
    // (> 30ms apart) keep their raw timing untouched.
    let when = Tone.now() + timeOffset;
    if (toneObjects._lastTriggerTime !== undefined && when <= toneObjects._lastTriggerTime + 0.030) {
      when = toneObjects._lastTriggerTime + 0.030;
    }
    toneObjects._lastTriggerTime = when;
    toneObjects.synth.triggerAttackRelease(note, duration, when, velocity);
  } catch (error) {
      console.error(`Tone.js scheduling error for ${id} at offset ${timeOffset.toFixed(3)}s:`, error.message);
  }
}

// Handle master mute/unmute functionality
function toggleMasterMute(activeSynths) {
    isMasterMuted = !isMasterMuted;

    if (isMasterMuted) {
        // Master mute ON: mute all regular synths that aren't already user-muted

        activeSynths.filter(instance => instance.id !== 'master').forEach(instance => {
            if (!instance.settings.muted) { // Only mute synths that aren't already user-muted
                instance.settings.mutedByMaster = true;
                muteSynthVolume(instance);
            }
        });
    } else {
        // Master mute OFF: restore all synths that were muted by master

        activeSynths.filter(instance => instance.id !== 'master').forEach(instance => {
            if (instance.settings.mutedByMaster) {
                instance.settings.mutedByMaster = false;
                unmuteSynthVolume(instance);
            }
        });
    }


    return isMasterMuted;
}

// Mute a synth's volume
function muteSynthVolume(instance) {
    if (!instance.toneObjects?.synth?.volume) return;

    // Save current volume before muting
    instance.settings.savedVolume = instance.toneObjects.synth.volume.value;

    // Disconnect LFO from volume if it's connected
    if (instance.settings.lfo.destination === 'volume') {
        try {
            instance.toneObjects.lfo.disconnect(instance.toneObjects.synth.volume);
        } catch(e) {
            console.warn(`Could not disconnect LFO from volume for ${instance.id}:`, e.message);
        }
    }

    // Mute the synth
    instance.toneObjects.synth.volume.rampTo(-Infinity, 0.05);

}

// Unmute a synth's volume
function unmuteSynthVolume(instance) {
    if (!instance.toneObjects?.synth?.volume || instance.settings.savedVolume === null) return;

    // Restore the saved volume
    instance.toneObjects.synth.volume.rampTo(instance.settings.savedVolume, 0.05);

    // Reconnect LFO if it targets volume
    if (instance.settings.lfo.destination === 'volume') {
        connectLFO(instance);
    }



    // Clear the saved volume
    instance.settings.savedVolume = null;
}

// Update master volume
function updateMasterVolume(value) {
    if (Tone.Destination.volume) {
        Tone.Destination.volume.rampTo(value, 0.02);
    }
    masterVolumeBeforeMute = value;
}

// Update master EQ
function updateMasterEQ(low, mid, high) {
    if (masterEQ) {
        masterEQ.low.value = low;
        masterEQ.mid.value = mid;
        masterEQ.high.value = high;
    }
}

// Update master compressor
function updateMasterCompressor(threshold, ratio) {
    if (masterCompressor) {
        masterCompressor.threshold.value = threshold;
        masterCompressor.ratio.value = ratio;
    }
}

// Current master output level per channel, in dB (read-only taps)
function getMasterMeterValues() {
    return [
        masterMeterL ? masterMeterL.getValue() : -Infinity,
        masterMeterR ? masterMeterR.getValue() : -Infinity,
    ];
}

// Update master limiter
function updateMasterLimiter(threshold) {
    if (masterLimiter) {
        masterLimiter.threshold.value = threshold;
    }
}

// Export the synthesis API
export {
    initAudio,
    initializeToneForInstance,
    disposeSynth,
    playTransactionSound,
    connectLFO,
    toggleMasterMute,
    muteSynthVolume,
    unmuteSynthVolume,
    updateMasterVolume,
    updateMasterEQ,
    updateMasterCompressor,
    updateMasterLimiter,
    getMasterMeterValues,
    scaleLfoDepth,
    rewireFxChain,
    updateSharedReverbRoomSize,
    unlockIOSAudioOnce
};

// Export state for debugging/UI purposes
export {
    synthsInitialized,
    isMasterMuted,
    masterVolumeBeforeMute
};
