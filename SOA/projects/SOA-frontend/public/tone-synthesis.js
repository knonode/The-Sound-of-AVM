/*
 * tone-synthesis.js - Core Tone.js audio synthesis engine
 * Separated from UI logic for better modularity and reusability
 */

// Tone.js synth setup - Core audio state
let synthsInitialized = false;
let masterEQ, masterCompressor, masterLimiter;
let isMasterMuted = false;
let masterVolumeBeforeMute = -3.0;

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

    const { lfo, synth, delay } = instance.toneObjects;
    const { destination, depth } = instance.settings.lfo;
    const { baseNote } = instance.settings; // Needed for pitch base freq
    const { volume: baseVolume } = instance.settings; // Needed for volume base level
    const { time: baseDelayTime } = instance.settings.delay; // Needed for delay base time

    // console.log(`LFO DEBUG (${instance.id}): connectLFO called. Dest: ${destination}, Depth: ${depth}, BaseVol: ${baseVolume}`); // <<< ADDED LOG

    // --- Disconnect from all potential targets first ---
    // console.log(`LFO DEBUG (${instance.id}): Attempting to disconnect LFO from previous targets...`); // <<< ADDED LOG
    try {
         // Simply call disconnect - it's safe if not connected
         lfo.disconnect(synth.oscillator.frequency);
         lfo.disconnect(synth.volume);
         lfo.disconnect(delay.delayTime);
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
                targetParam = synth.oscillator.frequency;
                targetParamName = 'synth.oscillator.frequency';
                const baseFreq = Tone.Frequency(baseNote).toFrequency();
                const ratio = Math.pow(2, scaledModulationAmount / 1200);
                lfo.min = baseFreq / ratio;
                lfo.max = baseFreq * ratio;
                break;
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
    await Tone.start();

      // <<< NEW: Initialize Master FX Chain >>>
      masterEQ = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
      masterCompressor = new Tone.Compressor({ threshold: -24, ratio: 4 });
      masterLimiter = new Tone.Limiter(-2);

      // Connect the master chain: EQ -> Compressor -> Limiter -> Final Output
      masterEQ.connect(masterCompressor);
      masterCompressor.connect(masterLimiter);
      masterLimiter.toDestination(); // Final connection to speakers

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

// Create Tone.js objects for a single synth instance
async function initializeToneForInstance(instance) {
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
        // Use Freeverb for realtime-adjustable room size
        const desiredRoomSize = (typeof settings.reverb?.roomSize === 'number')
            ? settings.reverb.roomSize
            : Math.max(0.05, Math.min(0.95, ((settings.reverb?.decay ?? 1.5) / 10)));
        const reverb = new Tone.Freeverb({
            roomSize: desiredRoomSize,
            wet: settings.reverb.wet
        });

        const synth = new Tone.Synth({
            oscillator: settings.oscillator,
            envelope: settings.envelope,
            volume: settings.muted ? -Infinity : settings.volume
        });

        const lfo = new Tone.LFO({
            frequency: settings.lfo.rate,
            type: settings.lfo.waveform,
            min: -1,
            max: 1,
            amplitude: 0
        }).start();

        // Chain: Synth -> Delay -> Reverb -> Master Bus -> Master Output
        synth.connect(delay);
        delay.connect(reverb);
        if (masterEQ) {
            reverb.connect(masterEQ);
        } else {
            reverb.toDestination();
        }

        // Store references on the instance
        instance.toneObjects = { synth, delay, reverb, lfo };

        // Connect LFO based on initial settings
        connectLFO(instance);

    } catch (error) {
        console.error(`Failed to initialize Tone.js objects for instance ${instance.id}:`, error);
        instance.toneObjects = null;
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
        instance.toneObjects.delay?.dispose();
        instance.toneObjects.reverb?.dispose();
    } catch (error) {
        console.error(`Error disposing Tone.js objects for ${instanceId}:`, error);
    }
    instance.toneObjects = null; // Clear the reference after disposal
}

// Play a transaction sound using the synthesis engine
function playTransactionSound(instance, timeOffset = 0) {
  const { id, settings, toneObjects } = instance;

  // Check if synth should be muted (either by user or by master)
  const isMuted = settings.muted || (settings.mutedByMaster && isMasterMuted);

  if (!toneObjects || isMuted) {
    return; // Don't play if muted or audio objects not ready
  }

  // --- SEQUENCER LOGIC ---
  const currentStep = settings.currentStepIndex ?? 0;
  const sequence = settings.sequence || [0, 0, 0, 0, 0, 0, 0, 0];
  const sequenceOffset = sequence[currentStep];
  // Advance step index for the next play *of this instance*
  instance.settings.currentStepIndex = (currentStep + 1) % 8;

  // --- Note Calculation ---
  const baseNote = settings.baseNote;
  const pitchShift = settings.pitch;
  const note = Tone.Frequency(baseNote).transpose(pitchShift + sequenceOffset);
  const duration = settings.noteDuration;
  const velocity = 0.7 + (Math.random() * 0.3); // Random velocity



  try {
    toneObjects.synth.triggerAttackRelease(note, duration, Tone.now() + timeOffset, velocity);
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
    scaleLfoDepth
};

// Export state for debugging/UI purposes
export {
    synthsInitialized,
    isMasterMuted,
    masterVolumeBeforeMute
};
