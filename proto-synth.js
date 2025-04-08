// At the top of proto-synth.js
import AlgorandAPI from './algorand-direct.js';

// Tone.js synth setup
let synthsInitialized = false;
let isPlaying = false;
let transactionCount = 0;
let txTypeCounts = {};
let initialPresets = {}; 

// <<< NEW: Array to hold individual synth instance states >>>
let activeSynths = []; 

// Define the chromatic scale for cycling
const chromaticScale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const defaultOctave = 4;

// <<< NEW: Function to get default settings for a NEW synth instance's Tone.js aspects >>>
function getDefaultInstanceSettings() {
    return {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
        volume: -30,
        muted: false,
        pitch: 0,
        delay: { time: 0, feedback: 0, wet: 0 },
        reverb: { decay: 1.5, wet: 0.3 },
        // <<< ADDED: LFO Default Settings >>>
        lfo: {
            rate: 5, // Hz
            depth: 0, // 0-100 scale, initially off
            waveform: 'sine',
            destination: 'none' // 'none', 'pitch', 'volume', 'delayTime'
        },
        // <<< END ADDITION >>>
        noteDuration: 0.1,
        baseNote: `A${defaultOctave}`,
        sequence: [0, 0, 0, 0, 0, 0, 0, 0], 
        currentStepIndex: 0
    };
}

// <<< NEW: Hardcoded Granularity Rules >>>
const granularityRules = {
  pay: [
    { subtype: 'amount', field: 'amt', params: ['min', 'max'], description: 'Amount range' },
    { subtype: 'sender', field: 'snd', params: ['address'], description: 'Sender address' },
    { subtype: 'receiver', field: 'rcv', params: ['address'], description: 'Receiver address' }
  ],
  axfer: [
    { subtype: 'assetid', field: 'xaid', params: ['asset-id'], description: 'Asset ID' },
    { subtype: 'amount', field: 'aamt', params: ['min', 'max'], description: 'Asset amount range' },
    { subtype: 'sender', field: 'asnd', params: ['address'], description: 'Asset sender' },
    { subtype: 'receiver', field: 'arcv', params: ['address'], description: 'Asset receiver' },
    { subtype: 'opt-in', field: 'xaid', params: ['asset-id'], description: 'Asset Opt-in ID' }, 
    { subtype: 'opt-out', field: 'aclose', params: ['address'], description: 'Asset Opt-out Close To' }, 
    { subtype: 'clawback', field: 'asnd', params: ['address'], description: 'Clawback Target Addr' } 
  ],
  appl: [
     { subtype: 'appid', field: 'apid', params: ['app-id'], description: 'Application ID'},
     { subtype: 'foreign-asset', field: 'apat', params: ['asset-id'], description: 'Includes Asset ID' },
     { subtype: 'foreign-account', field: 'apas', params: ['address'], description: 'Includes Account' }
  ],
  acfg: [
    { subtype: 'create', field: 'caid', params: ['manager-address'], description: 'Asset Create (Manager Addr)' }, 
    { subtype: 'reconfigure', field: 'caid', params: ['asset-id'], description: 'Asset Reconfigure ID' },
    { subtype: 'destroy', field: 'caid', params: ['asset-id'], description: 'Asset Destroy ID' }
  ],
  keyreg: [
      { subtype: 'online', field: 'votekey', params: ['toggle'], description: 'Online Registration' }, 
      { subtype: 'offline', field: 'nonpart', params: ['toggle'], description: 'Offline Registration' } 
  ],
  afrz: [
      { subtype: 'freeze', field: 'afrz', params: [], description: 'Freeze Asset (true)' }, 
      { subtype: 'unfreeze', field: 'afrz', params: [], description: 'Unfreeze Asset (false)' } 
  ],
  stpf: [
      { subtype: 'stpf', field: null, params: [], description: 'State Proof Transaction' } 
  ],
  hb: [
      { subtype: 'heartbeat', field: null, params: [], description: 'Heartbeat' }
  ]
};
// Get main types for easy access
const mainTxTypes = Object.keys(granularityRules);


// --- MODIFIED: Helper to initialize or reset type counts (using mainTxTypes) ---
function initializeTypeCounts() {
    txTypeCounts = {}; // Reset
    mainTxTypes.forEach(type => { 
        txTypeCounts[type] = 0; 
    });
    updateTypeCountsDisplay(); 
}

// <<< ADDED BACK: Function to Update Type Counts Display >>>
function updateTypeCountsDisplay() {
    const container = document.getElementById('type-counts-container');
    if (!container) {
        // console.warn("Type counts container not found in UI.");
        return;
    }

    // Build HTML string based on mainTxTypes order and current counts
    let htmlContent = mainTxTypes.map(type => {
        const count = txTypeCounts[type] || 0; // Get count, default to 0
        // Only display if count > 0 or always display? Let's display always for consistency.
        return `<span class="type-count" id="count-${type}">${type}: ${count}</span>`;
    }).join(' '); // Add space between counts

    container.innerHTML = htmlContent || 'No transactions yet.'; // Show message if empty
}

// SVG Icons for Mute/Unmute (Monochrome)
const svgIconUnmuted = `<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" style="display: block; margin: auto;">
  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
</svg>`;

const svgIconMuted = `<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" style="display: block; margin: auto;">
  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
</svg>`;

// <<< MODIFIED: createSynthHTML generates full UI for an instance >>>
const createSynthHTML = (synthInstance) => {
    const settings = { ...getDefaultInstanceSettings(), ...(synthInstance.settings || {}) };
    const config = synthInstance.config || { type: null, subtype: null, parameters: {} };
    const uniqueId = synthInstance.id;
    const typeClass = config.type ? `synth-${config.type}` : ''; 
    const currentVolume = settings.volume;

    // --- Generate sequence inputs HTML --- 
    let sequenceInputsHTML = '';
    for (let i = 0; i < 8; i++) {
        const seqValue = settings.sequence?.[i] ?? 0; 
        sequenceInputsHTML += `<div class="seq-step">
                                 <input type="number" id="${uniqueId}-seq-${i}" class="seq-input" value="${seqValue}" min="-24" max="24" step="1" title="Step ${i + 1}: Semitone offset" data-instance-id="${uniqueId}" data-seq-index="${i}">
                                 <div class="seq-indicator" id="${uniqueId}-seq-indicator-${i}"></div>
                               </div>`;
    }

    // --- Generate Header HTML --- 
    const headerHTML = `
        <div class="synth-header">
            <div class="led" id="led-${uniqueId}"></div>
            <select class="type-select" data-instance-id="${uniqueId}" title="Select Transaction Type">
                <option value="">Type</option>
                ${mainTxTypes.map(t => `<option value="${t}" ${config.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <select class="subtype-select" data-instance-id="${uniqueId}" title="Select Subtype (after Type)">
                <option value="">Sub</option>
                ${config.type && granularityRules[config.type] ? 
                    granularityRules[config.type].map(rule => `<option value="${rule.subtype}" ${config.subtype === rule.subtype ? 'selected' : ''}>${rule.subtype}</option>`).join('') : ''
                }
            </select>
            <button class="mute-btn" data-instance-id="${uniqueId}" title="Mute/Unmute Synth">${settings.muted ? svgIconMuted : svgIconUnmuted}</button>
            <button class="close-btn" data-instance-id="${uniqueId}" title="Remove Synth">×</button>
        </div>
    `;
      
    // --- Generate Parameter Area HTML --- 
    const parameterAreaHTML = `<div class="parameter-area" id="params-${uniqueId}"></div>`;

    // --- Generate Tone.js Controls HTML (NO CURLY BRACE COMMENTS) --- 
    const controlsHTML = `
        <!-- Volume Section -->
        <div class="volume-section"> 
            <div class="control-row">
                <span class="control-label">Volume: <span id="${uniqueId}-volume-value">${currentVolume.toFixed(1)} dB</span></span>
            </div>
            <div class="control-row">
                <input type="range" id="${uniqueId}-volume" min="-60" max="6" step="0.5" value="${currentVolume}" data-instance-id="${uniqueId}">
            </div>
        </div>
      
        <!-- Base Note Section -->
        <div class="base-note-section">
            <span class="control-label">Base Note</span>
            <div class="control-row base-note-controls">
                <button class="octave-down" data-instance-id="${uniqueId}" title="Octave Down">Oct-</button>
                <button class="base-note-down" data-instance-id="${uniqueId}" title="Note Down">←</button>
                <span class="base-note-display" id="${uniqueId}-base-note-display">${settings.baseNote}</span>
                <button class="base-note-up" data-instance-id="${uniqueId}" title="Note Up">→</button>
                <button class="octave-up" data-instance-id="${uniqueId}" title="Octave Up">Oct+</button>
            </div>
        </div>

        <!-- Step Sequencer Section -->
        <div class="sequencer-section">
            <span class="control-label">Sequencer (Semitone Offset)</span>
            <div class="control-row sequencer-steps">
                ${sequenceInputsHTML}
            </div>
        </div>

        <!-- Gate Time Section -->
        <div class="gate-section"> 
            <div class="control-row">
                <span class="control-label">Gate Time: <span id="${uniqueId}-note-duration-value">${settings.noteDuration.toFixed(2)}s</span></span>
            </div>
            <div class="control-row">
                <input type="range" id="${uniqueId}-note-duration" min="0.01" max="0.5" step="0.01" value="${settings.noteDuration}" data-instance-id="${uniqueId}">
            </div>
        </div>
      
        <!-- ADSR Section -->
        <div class="adsr-section"> 
            <div class="control-row"> 
                <span class="control-label">Attack</span> <span class="control-label">Decay</span>
            </div>
            <div class="control-row">
                <input type="range" id="${uniqueId}-attack" min="0" max="1" step="0.01" value="${settings.envelope.attack}" data-instance-id="${uniqueId}" data-param="attack">
                <input type="range" id="${uniqueId}-decay" min="0" max="1" step="0.01" value="${settings.envelope.decay}" data-instance-id="${uniqueId}" data-param="decay">
            </div>
            <div class="control-row">
                <span class="control-label">Sustain</span> <span class="control-label">Release</span>
            </div>
            <div class="control-row">
                <input type="range" id="${uniqueId}-sustain" min="0" max="1" step="0.01" value="${settings.envelope.sustain}" data-instance-id="${uniqueId}" data-param="sustain">
                <input type="range" id="${uniqueId}-release" min="0" max="2" step="0.01" value="${settings.envelope.release}" data-instance-id="${uniqueId}" data-param="release">
            </div>
        </div>
      
        <!-- Waveform Section -->
        <div class="waveform-section">
            <div class="control-row"> 
                <span class="control-label inline-label">Waveform</span> 
                <select id="${uniqueId}-waveform" class="compact-select" data-instance-id="${uniqueId}">
                    <option value="sine" ${settings.oscillator.type === 'sine' ? 'selected' : ''}>Sine</option>
                    <option value="square" ${settings.oscillator.type === 'square' ? 'selected' : ''}>Square</option>
                    <option value="triangle" ${settings.oscillator.type === 'triangle' ? 'selected' : ''}>Triangle</option>
                    <option value="sawtooth" ${settings.oscillator.type === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
                </select>
            </div>
        </div>
      
        <!-- Effect Controls Section -->
        <div class="effect-controls">
            <div class="control-row"> <span class="control-label">Pitch: <span id="${uniqueId}-pitch-value">${settings.pitch}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-pitch" min="-12" max="12" step="1" value="${settings.pitch}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Delay Time: <span id="${uniqueId}-delay-time-value">${settings.delay.time.toFixed(2)}s</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-delay-time" min="0" max="1" step="0.01" value="${settings.delay.time}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Feedback: <span id="${uniqueId}-delay-feedback-value">${settings.delay.feedback.toFixed(2)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-delay-feedback" min="0" max="0.9" step="0.01" value="${settings.delay.feedback}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Delay Wet: <span id="${uniqueId}-delay-wet-value">${settings.delay.wet.toFixed(2)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-delay-wet" min="0" max="1" step="0.01" value="${settings.delay.wet}" data-instance-id="${uniqueId}"> </div>
        </div>
        
        <!-- Reverb Section -->
        <div class="reverb-section"> 
            <div class="control-row"> <span class="control-label">Reverb Decay: <span id="${uniqueId}-reverb-decay-value">${settings.reverb.decay.toFixed(2)}s</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-reverb-decay" min="0.1" max="10" step="0.1" value="${settings.reverb.decay}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Reverb Wet: <span id="${uniqueId}-reverb-wet-value">${settings.reverb.wet.toFixed(2)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-reverb-wet" min="0" max="1" step="0.01" value="${settings.reverb.wet}" data-instance-id="${uniqueId}"> </div>
        </div>

        <!-- LFO Section -->
        <div class="lfo-section">
            <span class="control-label">LFO</span> 
            <div class="control-row"> <span class="control-label">Rate: <span id="${uniqueId}-lfo-rate-value">${settings.lfo.rate.toFixed(1)} Hz</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-lfo-rate" min="0.1" max="20" step="0.1" value="${settings.lfo.rate}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Depth: <span id="${uniqueId}-lfo-depth-value">${settings.lfo.depth.toFixed(0)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-lfo-depth" min="0" max="100" step="1" value="${settings.lfo.depth}" data-instance-id="${uniqueId}"> </div>

            <div class="control-row">
                <span class="control-label inline-label">Waveform</span> 
                <select id="${uniqueId}-lfo-waveform" class="lfo-waveform-select compact-select" data-instance-id="${uniqueId}">
                    <option value="sine" ${settings.lfo.waveform === 'sine' ? 'selected' : ''}>Sine</option>
                    <option value="square" ${settings.lfo.waveform === 'square' ? 'selected' : ''}>Square</option>
                    <option value="triangle" ${settings.lfo.waveform === 'triangle' ? 'selected' : ''}>Triangle</option>
                    <option value="sawtooth" ${settings.lfo.waveform === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
                </select>
            </div>

            <div class="control-row">
                <span class="control-label inline-label">Dest.</span> 
                <select id="${uniqueId}-lfo-destination" class="lfo-destination-select compact-select" data-instance-id="${uniqueId}">
                    <option value="none" ${settings.lfo.destination === 'none' ? 'selected' : ''}>None</option>
                    <option value="pitch" ${settings.lfo.destination === 'pitch' ? 'selected' : ''}>Pitch</option>
                    <option value="volume" ${settings.lfo.destination === 'volume' ? 'selected' : ''}>Volume</option>
                    <option value="delayTime" ${settings.lfo.destination === 'delayTime' ? 'selected' : ''}>Delay Time</option>
                </select>
            </div>
        </div>
    `;

    // Combine parts
    const htmlString = `
        <div class="mini-synth ${typeClass}" data-instance-id="${uniqueId}">
            ${headerHTML}
            ${parameterAreaHTML}
            ${controlsHTML}
        </div>
    `;
    return htmlString;
};

// <<< MODIFIED: initAudio creates Tone objects per instance >>>
const initAudio = async () => {
  if (synthsInitialized) return; // Prevent re-running if already initialized globally
  
  console.log('Attempting Global Audio Initialization...');
  try {
  await Tone.start();
      console.log('Global Audio context started');
      synthsInitialized = true;
      updateStatus('Audio ready');
  } catch (error) {
      console.error("Failed to start Tone.js Audio Context:", error);
      alert("Could not initialize Web Audio. Please refresh or use a compatible browser.");
      return; // Stop if context fails
  }
  
  // Now initialize Tone objects for existing synth instances in the UI (if any were loaded from preset)
  console.log("Initializing Tone.js objects for any pre-existing active synth instances...");
  for (const instance of activeSynths) { // Loop through instances potentially loaded from a preset
      if (!instance.toneObjects) { 
          await initializeToneForInstance(instance.id);
      }
  }
};

// <<< NEW: Helper to initialize Tone objects for a single instance >>>
async function initializeToneForInstance(instanceId) {
    const instance = findInstance(instanceId);
    if (!instance || instance.toneObjects) return; // Already initialized or instance not found

    // Ensure audio context is started before creating nodes
    if (!synthsInitialized) {
        console.warn("Audio context not started, attempting start before initializing instance:", instanceId);
        await initAudio(); // This will call Tone.start() if needed
        if (!synthsInitialized) {
             console.error("Failed to start audio context for instance initialization.");
             return; // Exit if context failed
        }
    }

    console.log(`Initializing Tone.js objects for instance ${instanceId}`);
    try {
        const settings = instance.settings;
        const delay = new Tone.FeedbackDelay({
            delayTime: settings.delay.time,
            feedback: settings.delay.feedback,
            wet: settings.delay.wet
        });
        const reverb = new Tone.Reverb({
            decay: settings.reverb.decay,
            wet: settings.reverb.wet
        }).toDestination();

        await reverb.generate(); // Pre-generate reverb impulse response

        const synth = new Tone.Synth({
            oscillator: settings.oscillator,
            envelope: settings.envelope,
            volume: settings.muted ? -Infinity : settings.volume 
        });

        // <<< ADDED: LFO Creation >>>
        const lfo = new Tone.LFO({
            frequency: settings.lfo.rate,
            type: settings.lfo.waveform,
            min: -1, // Placeholder min/max, will be set by connectLFO
            max: 1,
            amplitude: 0, // Start with 0 amplitude until connected and depth applied
        }).start();
        // <<< END ADDITION >>>

        // Chain: Synth -> Delay -> Reverb -> Master Output
        synth.connect(delay);
        delay.connect(reverb);
    
        // Store references on the instance
        instance.toneObjects = { synth, delay, reverb, lfo }; // <<< Added lfo >>>
        console.log(`Tone.js objects created successfully for ${instanceId}`);

        // <<< ADDED: Connect LFO based on initial settings >>>
        connectLFO(instance);

    } catch (error) {
        console.error(`Failed to initialize Tone.js objects for instance ${instanceId}:`, error);
        instance.toneObjects = null; 
    }
}

// <<< MODIFIED: disposeSynth uses instanceId and disposes instance's toneObjects >>>
function disposeSynth(instanceId) {
    const instance = findInstance(instanceId);
    if (!instance || !instance.toneObjects) {
         // console.log(`No Tone.js objects to dispose for instance ${instanceId}`);
         return; // Nothing to dispose
    }

    console.log(`Disposing Tone.js objects for instance ${instanceId}`);
    try {
        // Check dispose method exists before calling
        instance.toneObjects.lfo?.dispose(); // <<< Dispose LFO >>>
        instance.toneObjects.synth?.dispose();
        instance.toneObjects.delay?.dispose();
        instance.toneObjects.reverb?.dispose();
    } catch (error) {
        console.error(`Error disposing Tone.js objects for ${instanceId}:`, error);
    }
    instance.toneObjects = null; // Clear the reference after disposal
}

// <<< REWRITTEN: startTransactionStream uses new instance logic >>>
const startTransactionStream = async () => {
  if (!synthsInitialized) {
      console.log("Audio not initialized, attempting init...");
      await initAudio();
      if (!synthsInitialized) {
          alert('Audio could not be initialized.');
          return;
      }
  }
  // Ensure all active synths have Tone objects initialized
  for (const instance of activeSynths) {
      if (!instance.toneObjects) {
          console.log(`Initializing Tone for instance ${instance.id} before starting stream...`);
          await initializeToneForInstance(instance.id);
      }
  }

  // Reset counters
  transactionCount = 0;
  initializeTypeCounts(); 
  // Reset sequence indices for all instances
  activeSynths.forEach(inst => inst.settings.currentStepIndex = 0);

  isPlaying = true;
  updateStatus('Connecting to Algorand node...');

  const connected = await AlgorandAPI.initAlgodConnection();
  if (!connected) {
    console.error("Couldn't connect to Algorand node");
    updateStatus('Failed to connect to Algorand node');
    isPlaying = false;
    alert('Could not connect to the Algorand node.');
    return;
  }

  console.log("Connected to Algorand node - starting transaction polling");
  updateStatus('Connected - Streaming transactions');

    AlgorandAPI.startPolling((txType, txData, index) => {
      if (!isPlaying) return;

    // --- Core Matching Logic --- 
    const mainType = txType.split('-')[0]; // Get base type (e.g., 'pay', 'axfer')
    
    // --- Update Global Counts --- 
      transactionCount++;
      const totalCountEl = document.getElementById('transaction-count');
      if (totalCountEl) totalCountEl.textContent = `${transactionCount} transactions processed`;
    if (txTypeCounts.hasOwnProperty(mainType)) {
        txTypeCounts[mainType]++;
      } else {
        txTypeCounts[mainType] = 1; // Count even if no synth is configured
      }
      updateTypeCountsDisplay();
      // --- End Count Update ---

    // --- NEW Prioritized Matching Logic ---
    let potentialMatches = activeSynths.filter(instance => instance.config.type === mainType);

    if (potentialMatches.length === 0) {
        // No instances configured for this main type, do nothing for sound
        return; 
    }

    let specificMatches = [];
    let generalMatches = [];

    potentialMatches.forEach(instance => {
        if (instance.config.subtype) {
            // Check if specific subtype/params match
            if (checkTransactionMatch(instance.config, txData)) {
                specificMatches.push(instance);
            }
        } else {
            // It's a general match (type matches, no subtype)
            generalMatches.push(instance);
        }
    });

    let instancesToPlay = [];
    if (specificMatches.length > 0) {
        // If any specific synth matches, only play those
        instancesToPlay = specificMatches;
        console.log(`TX ${txType} matched ${specificMatches.length} SPECIFIC instances.`);
    } else if (generalMatches.length > 0) {
        // If no specific match, but general matches exist, play the general ones
        instancesToPlay = generalMatches;
         console.log(`TX ${txType} matched ${generalMatches.length} GENERAL instances (no specific matches).`);
    } else {
        // No matches found for this type (specific check failed for all relevant subtypes)
        // console.log(`TX ${txType} - No specific or general matches found.`);
        // This case might occur if a type exists but all its specific subtypes fail the checkTransactionMatch
    }

    // Play sound for the selected instances (either specific or general)
    if (instancesToPlay.length > 0) {
        instancesToPlay.forEach((instance, matchIndex) => {
            if (!instance.settings.muted && instance.toneObjects) {
                 // Use matchIndex for slight time offset if multiple synths match same tx
                playTransactionSound(instance, matchIndex * 0.010); 
            }
        });
    }
    // --- END NEW Prioritized Matching Logic ---

    /* --- OLD LOGIC (Replaced) ---
    const oldMatchingInstances = activeSynths.filter(instance => {
        if (!instance.config.type || instance.config.type !== mainType) return false;
        if (!instance.config.subtype) return true; 
        return checkTransactionMatch(instance.config, txData);
    });
    if (oldMatchingInstances.length > 0) {
        console.log(`(Old Logic) TX ${txType} matched ${oldMatchingInstances.length} instances.`);
        oldMatchingInstances.forEach((instance, matchIndex) => { 
             // playTransactionSound(instance, matchIndex * 0.010); 
         });
    }
    */

   }, 50); // Polling interval
};

// <<< REWRITTEN: stopTransactionStream remains simple >>>
const stopTransactionStream = () => {
  isPlaying = false;
  AlgorandAPI.stopPolling();
  updateStatus('Stream stopped');
  // Optionally reset LEDs or indicators here
  document.querySelectorAll('.led.active').forEach(led => led.classList.remove('active'));
  document.querySelectorAll('.seq-indicator.active').forEach(ind => ind.classList.remove('active'));
};

// <<< NEW: Helper function to check if a transaction matches instance config >>>
function checkTransactionMatch(config, txData) {
    const { type, subtype, parameters } = config;
    const rule = granularityRules[type]?.find(r => r.subtype === subtype);

    if (!rule) return false; // No rule found for this subtype

    // Ensure we have the transaction details, often nested under 'txn'
    const txn = txData?.txn ?? txData; // Handle both potential structures

    // TODO: Implement specific matching logic based on subtype and parameters
    // This needs to look into txData structure based on Algorand specs
    // Examples:
    switch (`${type}-${subtype}`) {
        case 'pay-amount':
             // ... existing pay-amount logic using txn ...
             const amt = txn?.amt ?? null;
             if (amt === null) return false;
             const userMin = parameters.min ?? null;
             const userMax = parameters.max ?? null;
             const minAmtMicroAlgos = userMin !== null ? userMin * 1000000 : -Infinity;
             const maxAmtMicroAlgos = userMax !== null ? userMax * 1000000 : Infinity;
             return amt >= minAmtMicroAlgos && amt <= maxAmtMicroAlgos;
        case 'pay-sender':
            // ... existing pay-sender logic using txn ...
            const snd = txn?.snd ?? null;
            return snd === parameters.address;
        case 'pay-receiver':
            // ... existing pay-receiver logic using txn ...
            const rcv = txn?.rcv ?? null;
            return rcv === parameters.address;

        case 'axfer-assetid': // Matches any transfer of a specific asset
            // ... existing axfer-assetid logic using txn ...
            const xaid = txn?.xaid ?? null;
            // Ensure parameter asset-id is treated as a number if present
            const targetAssetId = parameters['asset-id'] !== undefined ? Number(parameters['asset-id']) : undefined;
            return xaid !== null && (targetAssetId === undefined || xaid === targetAssetId);
        case 'axfer-amount':
            // ... existing axfer-amount logic using txn ...
            const aamt = txn?.aamt ?? null;
            if (aamt === null) return false;
            const minAamt = parameters.min ?? -Infinity;
            const maxAamt = parameters.max ?? Infinity;
            return aamt >= minAamt && aamt <= maxAamt;
        case 'axfer-sender':
             // ... existing axfer-sender logic using txn ...
             const asnd_axfer = txn?.asnd ?? null;
             return asnd_axfer === parameters.address;
        case 'axfer-receiver':
             // ... existing axfer-receiver logic using txn ...
             const arcv = txn?.arcv ?? null;
             return arcv === parameters.address;
        case 'axfer-opt-in':
             // ... existing axfer-opt-in logic using txn ...
             const isOptInAmt = (txn?.aamt ?? -1) === 0;
             const isOptInTarget = (txn?.arcv) === (txn?.snd);
             const optInAssetId = txn?.xaid ?? null;
              // Ensure parameter asset-id is treated as a number if present
             const optInTargetAssetId = parameters['asset-id'] !== undefined ? Number(parameters['asset-id']) : undefined;
             return isOptInAmt && isOptInTarget && (optInTargetAssetId === undefined || optInAssetId === optInTargetAssetId);
        case 'axfer-clawback':
             // ... existing axfer-clawback logic using txn ...
             const clawbackTarget = txn?.asnd ?? null;
             console.warn("Clawback matching is complex and not fully implemented.");
             return clawbackTarget === parameters.address;

        case 'appl-appid':
            // ... existing appl-appid logic using txn ...
            const apid = txn?.apid ?? null;
            // Ensure parameter app-id is treated as a number if present
            const targetAppId = parameters['app-id'] !== undefined ? Number(parameters['app-id']) : undefined;
            return apid !== null && targetAppId !== undefined && apid === targetAppId;

        // <<< Logic for new appl subtypes >>>
        case 'appl-foreign-asset':
            const apat = txn?.apat ?? []; // Default to empty array if undefined
            const searchAssetId = parameters['asset-id'] !== undefined ? Number(parameters['asset-id']) : undefined;
            if (searchAssetId === undefined) {
                return false; // Or maybe return true if ANY asset is present? For now, require ID.
            }
            // Check if the searchAssetId exists in the apat array
            return apat.includes(searchAssetId);

        case 'appl-foreign-account':
            const apas = txn?.apas ?? []; // Default to empty array if undefined
            const searchAddress = parameters['address'];
            if (!searchAddress) {
                return false; // Require an address parameter
            }
            // Check if the searchAddress exists in the apas array
            return apas.includes(searchAddress);

        case 'keyreg-online':
             // ... existing keyreg-online logic using txn ...
             return txn?.votekey !== undefined && txn?.nonpart !== true;
        case 'keyreg-offline':
             // ... existing keyreg-offline logic using txn ...
             return txn?.nonpart === true;

        case 'afrz-freeze':
             // ... existing afrz-freeze logic using txn ...
             return (txn?.afrz) === true;
        case 'afrz-unfreeze':
             // ... existing afrz-unfreeze logic using txn ...
              return (txn?.afrz) === false;

        case 'stpf-stpf': // Matches any state proof tx
            return true; // Already matched by main type 'stpf'

        // Add cases for other subtypes

        default:
            console.warn(`Matching logic not implemented for ${type}-${subtype}`);
            return false;
    }

}

// <<< REWRITTEN: playTransactionSound uses instance data >>>
const playTransactionSound = (instance, timeOffset = 0) => {
  const { id, settings, toneObjects } = instance;

  if (!toneObjects || settings.muted) {
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

  // console.log(`Instance ${id}: Playing ${note} (Dur: ${duration}, Vel: ${velocity.toFixed(2)}) at +${timeOffset.toFixed(3)}s`);

  try {
    toneObjects.synth.triggerAttackRelease(note, duration, Tone.now() + timeOffset, velocity);
  } catch (error) {
      console.error(`Tone.js scheduling error for ${id} at offset ${timeOffset.toFixed(3)}s:`, error.message);
  }

  // Flash LED and Sequencer Indicator (with same offset)
  setTimeout(() => {
    flashLED(id); // Pass instance ID
    updateSequencerIndicator(id, currentStep); // Pass instance ID
  }, timeOffset * 1000);
};

// --- Modify LED/Sequencer functions to use instance ID ---

const flashLED = (instanceId) => {
  const led = document.getElementById(`led-${instanceId}`);
  if (!led) return;
  led.classList.add('active');
  setTimeout(() => led.classList.remove('active'), 100);
};

let activeIndicatorTimeouts = {}; // Keep this global for now

const updateSequencerIndicator = (instanceId, stepIndex) => {
    // Clear previous timeout for this instance if exists
    if (activeIndicatorTimeouts[instanceId]) {
        clearTimeout(activeIndicatorTimeouts[instanceId].timeoutId);
        const oldIndicator = document.getElementById(`${instanceId}-seq-indicator-${activeIndicatorTimeouts[instanceId].stepIndex}`);
        oldIndicator?.classList.remove('active');
    }

    const indicator = document.getElementById(`${instanceId}-seq-indicator-${stepIndex}`);
    if (indicator) {
        indicator.classList.add('active');
        const timeoutId = setTimeout(() => {
            indicator.classList.remove('active');
            delete activeIndicatorTimeouts[instanceId];
        }, 150); 
        activeIndicatorTimeouts[instanceId] = { timeoutId, stepIndex };
    }
};

// Update the status display
const updateStatus = (message) => {
  document.getElementById('status').textContent = message;
};

// Handle waveform selection
document.querySelectorAll('.waveform-select').forEach(select => {
  select.addEventListener('change', (e) => {
    const type = e.target.id.split('-')[0];
    const waveform = e.target.value;
    
    if (activeSynths[type] && activeSynths[type].toneObjects) {
      activeSynths[type].toneObjects.synth.oscillator.type = waveform;
    }
  });
});

// Handle pitch control changes
document.querySelectorAll('input[id$="-pitch"]').forEach(input => {
  input.addEventListener('input', (e) => {
    const type = e.target.id.split('-')[0];
    const value = parseInt(e.target.value);
    
    if (activeSynths[type] && activeSynths[type].toneObjects) {
      activeSynths[type].toneObjects.synth.oscillator.frequency.value = Tone.Frequency(activeSynths[type].baseNote).transpose(value);
    }
  });
});

// Handle note duration changes
document.querySelectorAll('input[id$="-note-duration"]').forEach(input => {
  input.addEventListener('input', (e) => {
    const type = e.target.id.split('-')[0];
    const value = parseFloat(e.target.value);
    
    if (activeSynths[type] && activeSynths[type].toneObjects) {
      activeSynths[type].toneObjects.synth.envelope.release = value;
    }
  });
});

// <<< Function to load presets from JSON file >>>
async function loadInitialPresets() {
  try {
    const response = await fetch('presets.json'); // Correct path
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    initialPresets = await response.json();
    console.log("Successfully loaded initial presets from presets.json:", initialPresets);
  } catch (error) {
    console.error("Could not load initial presets from presets.json:", error);
    initialPresets = {}; // Ensure it's an empty object on error
  }
}

// <<< REWRITTEN: loadPreset handles migration from old format >>>
const loadPreset = async () => {
  const presetList = document.getElementById('preset-list');
  const presetName = presetList.value;
  if (!presetName) return;

  let loadedData = null;
  let presetSource = "";
  let isOldFormat = false;

  // Check initial presets first
  if (initialPresets[presetName]) {
      loadedData = initialPresets[presetName];
      presetSource = "initial file";
      // Check if the bundled preset itself is old or new format
      isOldFormat = loadedData.settings && !loadedData.activeSynths; 
      } else {
      // Fallback to Local Storage
      const userPresets = JSON.parse(localStorage.getItem('txSynthPresets') || 'null');
      if (userPresets && userPresets[presetName]) {
          loadedData = userPresets[presetName];
          presetSource = "local storage";
          // Check if the loaded local preset is old or new format
          isOldFormat = loadedData.settings && !loadedData.activeSynths;
      } 
  }

  if (!loadedData) {
    alert('Preset not found');
    return;
  }

  console.log(`Loading preset: ${presetName} (from ${presetSource})`);

  // --- Clear Current State --- 
  console.log("Clearing current synths and UI...");
  // Dispose existing Tone objects first
  activeSynths.forEach(instance => disposeSynth(instance.id));
  activeSynths = []; // Clear the main state array
  const synthContainer = document.getElementById('synth-container');
  synthContainer.innerHTML = ''; // Clear UI
  // synthsInitialized remains true if context was started

  // --- Process Loaded Data (Migrate if necessary) --- 
  let targetActiveSynths = [];
  if (isOldFormat) {
      console.warn(`Preset '${presetName}' is in old format. Migrating... Granularity will be lost.`);
      // Attempt migration from old { settings: { pay: {...}, axfer: {...} } } structure
      if (loadedData.settings && typeof loadedData.settings === 'object') {
            // Use displayedSynths order if available, otherwise just iterate settings keys
            const typesToLoad = loadedData.displayedSynths || Object.keys(loadedData.settings);
            
            typesToLoad.forEach(type => {
                if (loadedData.settings[type]) { // Check if settings for this type exist
                    const oldSettings = loadedData.settings[type];
                    const uniqueId = `synth-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                    const newInstance = {
                        id: uniqueId,
                        config: { type: type, subtype: null, parameters: {} }, // Basic config
                        settings: { // Merge old settings into defaults
                             ...getDefaultInstanceSettings(), // Start with defaults
                             ...oldSettings // Overwrite with saved values
                             // Ensure nested objects are handled if necessary (defaults cover it)
                        },
                        toneObjects: null
                    };
                    targetActiveSynths.push(newInstance);
      } else {
                     console.warn(`Type "${type}" listed in old preset but settings missing.`);
                }
            });
      } else {
          alert(`Failed to migrate old preset format for '${presetName}'. Invalid structure.`);
          return;
      }
  } else if (loadedData.activeSynths && Array.isArray(loadedData.activeSynths)) {
      // New format: Load directly
      console.log("Loading preset in new format.");
      // Deep copy might be safer if objects are complex, but direct assign is ok for now
      // We need to ensure each loaded instance has default settings applied correctly if partial
       targetActiveSynths = loadedData.activeSynths.map(loadedInstance => ({ 
            ...loadedInstance, // Spread loaded data (id, config)
            settings: { // Ensure settings are complete
                 ...getDefaultInstanceSettings(), 
                 ...(loadedInstance.settings || {})
            },
            toneObjects: null // Tone objects always start as null when loading
        }));
  } else {
       alert(`Preset '${presetName}' has an unrecognized format.`);
       return;
  }

   // --- Update State and Rebuild UI --- 
  activeSynths = targetActiveSynths; // Set the global state
  console.log("Applied loaded/migrated settings. Active Synths:", activeSynths);

  console.log("Rebuilding UI...");
  activeSynths.forEach(instance => {
      synthContainer.innerHTML += createSynthHTML(instance);
      // Render parameter area based on loaded config
      renderParameterArea(instance.id, instance.config.type, instance.config.subtype);
  });

  // --- Initialize Audio for New Instances --- 
  console.log("Initializing audio objects for loaded synths...");
  // Ensure global context is running first
  if (!synthsInitialized) { await initAudio(); } 
  // Initialize Tone for each loaded instance
  for (const instance of activeSynths) {
      await initializeToneForInstance(instance.id);
  }

  // --- Update Other UI --- 
  // initializeEventListeners(); // Delegated listeners are already attached
  // updateAllValueDisplays(); // TODO: Implement this later
  // updateAllSequencerDisplays(); // TODO: Implement this later
  console.log(`Preset "${presetName}" loaded successfully.`);
  updateStatus(`Preset "${presetName}" loaded`);
  // Optionally clear status after a delay
  // setTimeout(() => updateStatus('Streaming...'), 2000); 
};

// <<< REWRITTEN: savePreset uses new instance structure >>>
const savePreset = () => {
  const presetName = document.getElementById('preset-name').value.trim();
  if (!presetName) {
    alert('Please enter a preset name');
    return;
  }

  // Create the preset object in the NEW format
  const presetData = {
    // Store the current state of the activeSynths array
    // We only need to save config and settings, not toneObjects
    activeSynths: activeSynths.map(instance => ({
        id: instance.id, // Keep ID for potential future use?
        config: instance.config,
        settings: instance.settings
    }))
  };

  console.log(`Saving preset '${presetName}' with data:`, presetData);

  // Save to Local Storage
  const presets = JSON.parse(localStorage.getItem('txSynthPresets') || '{}');
  presets[presetName] = presetData; // Save the new structure
  try {
      localStorage.setItem('txSynthPresets', JSON.stringify(presets));
      updatePresetList(); // Update dropdown
      console.log(`Preset "${presetName}" saved successfully to Local Storage.`);
      updateStatus(`Preset "${presetName}" saved`);
  } catch (error) {
      console.error("Error saving preset to Local Storage:", error);
      alert("Failed to save preset. Local Storage might be full or disabled.");
  }
};

// Update the preset dropdown list
const updatePresetList = () => {
  const presetList = document.getElementById('preset-list');
  presetList.innerHTML = '<option value="">Select a preset</option>'; // Clear existing options

  // --- ADDED: Optgroup for Initial Presets ---
  const initialGroup = document.createElement('optgroup');
  initialGroup.label = "Bundled Presets";
  let hasInitialPresets = false;
  for (const name in initialPresets) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    initialGroup.appendChild(option);
    hasInitialPresets = true;
  }
  if (hasInitialPresets) {
      presetList.appendChild(initialGroup);
  }
  // --- END ADDITION ---

  // --- MODIFIED: Optgroup for User Presets ---
  const userPresets = JSON.parse(localStorage.getItem('txSynthPresets') || 'null'); // Check null
  if (userPresets && Object.keys(userPresets).length > 0) { // Check userPresets is not null
      const userGroup = document.createElement('optgroup');
      userGroup.label = "My Presets";
      for (const name in userPresets) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
        userGroup.appendChild(option);
  }
      presetList.appendChild(userGroup);
  }
  // --- END MODIFICATION ---
};

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => { 
  const synthContainer = document.getElementById('synth-container');
  const addSynthButton = document.getElementById('add-synth');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const savePresetNameBtn = document.getElementById('save-preset-name');
  const presetListSelect = document.getElementById('preset-list'); 
  // Remove reference/listener for top bar #load-preset if it exists

  if (!synthContainer || !addSynthButton || !startBtn || !stopBtn || !savePresetNameBtn || !presetListSelect) {
      console.error("One or more essential UI elements not found!");
      return; 
  }

  await loadInitialPresets(); 
  await initAudio(); // <<< Initialize global audio context FIRST >>>

  // Start empty or load default preset later
  activeSynths = []; 
  synthContainer.innerHTML = ''; 
  
  addSynthButton.addEventListener('click', async () => { // <<< Made async >>>
    const uniqueId = `synth-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newInstance = {
        id: uniqueId,
        config: { type: null, subtype: null, parameters: {} },
        settings: getDefaultInstanceSettings(), 
        toneObjects: null 
    };
    activeSynths.push(newInstance);
    console.log("Added new synth instance to state:", newInstance);

    const newSynthHTML = createSynthHTML(newInstance);
    synthContainer.insertAdjacentHTML('beforeend', newSynthHTML);

    // Initialize Tone.js objects for the newly added synth
    await initializeToneForInstance(uniqueId); 

    // Render initial parameter area (which will be empty or based on default subtype if any)
    renderParameterArea(uniqueId, null, null); 

    // No need to re-attach listeners due to delegation
  });
  
  // Attach main control listeners (Start, Stop, Save Preset, Load Preset Dropdown)
  startBtn.addEventListener('click', startTransactionStream); 
  stopBtn.addEventListener('click', stopTransactionStream);
  savePresetNameBtn.addEventListener('click', savePreset);
  presetListSelect.addEventListener('change', loadPreset); 

  // Attach delegated listeners to the container ONCE
  initializeEventListeners(); 

  updatePresetList();
  updateStatus('Ready');
  initializeTypeCounts();
  injectSliderStyles(); 
});

// <<< MODIFIED: initializeEventListeners Uses Event Delegation >>>
const initializeEventListeners = () => {
    const synthContainer = document.getElementById('synth-container');
    if (!synthContainer) {
        console.error("Synth container not found for event listeners.");
        return;
    }

    // Remove old listeners first to prevent duplicates if called multiple times
    synthContainer.removeEventListener('click', handleContainerClick);
    synthContainer.removeEventListener('change', handleContainerChange);
    synthContainer.removeEventListener('input', handleContainerInput); 

    // Add new delegated listeners
    synthContainer.addEventListener('click', handleContainerClick);
    synthContainer.addEventListener('change', handleContainerChange);
    synthContainer.addEventListener('input', handleContainerInput); 
    console.log("Delegated event listeners attached to synthContainer.");
};

// --- Delegated Event Handlers ---

const handleContainerClick = (e) => {
    const target = e.target;
    // Find the closest parent synth element to get the instance ID
    const synthElement = target.closest('.mini-synth');
    if (!synthElement) return; 
    const instanceId = synthElement.dataset.instanceId;
    if (!instanceId) return; // Should not happen if structure is correct

    // Determine which control was clicked and call the appropriate logic function
    if (target.matches('.mute-btn') || target.closest('.mute-btn')) { // Handle clicks on SVG inside button
        handleMuteLogic(instanceId, synthElement.querySelector('.mute-btn')); // Pass button itself
    } else if (target.matches('.close-btn')) {
        handleCloseLogic(instanceId, synthElement);
    } else if (target.matches('.base-note-down')) {
        handleBaseNoteChangeLogic(instanceId, -1);
    } else if (target.matches('.base-note-up')) {
        handleBaseNoteChangeLogic(instanceId, 1);
    } else if (target.matches('.octave-down')) {
        handleOctaveChangeLogic(instanceId, -1);
    } else if (target.matches('.octave-up')) {
        handleOctaveChangeLogic(instanceId, 1);
    } else if (target.matches('.keyreg-toggle')) {
        handleKeyregToggleLogic(instanceId, target);
    }
};

const handleContainerChange = (e) => {
    const target = e.target;
    const instanceId = target.dataset.instanceId; // Controls should have data-instance-id
    if (!instanceId) return; // Not a control we manage this way

    if (target.matches('.type-select')) {
        handleTypeChangeLogic(instanceId, target.value, target);
    } else if (target.matches('.subtype-select')) {
        handleSubtypeChangeLogic(instanceId, target.value, target);
    } else if (target.matches('.waveform-select')) {
        handleWaveformChangeLogic(instanceId, target.value);
    } else if (target.matches('.seq-input')) {
        const index = parseInt(target.dataset.seqIndex, 10);
        handleSequenceChangeLogic(instanceId, index, target.value, target);
    } else if (target.matches('.param-input')) {
        handleParameterChangeLogic(instanceId, target);
    } else if (target.matches('.lfo-waveform-select')) { // <<< ADDED >>>
        handleLfoWaveformChangeLogic(instanceId, target.value);
    } else if (target.matches('.lfo-destination-select')) { // <<< ADDED >>>
        handleLfoDestinationChangeLogic(instanceId, target.value);
    }
};

const handleContainerInput = (e) => {
    // Handles real-time updates for range sliders
    const target = e.target;
    if (target.type !== 'range') return;
    const instanceId = target.dataset.instanceId;
    if (!instanceId) return;

    // Identify the control based on its ID structure
    const idParts = target.id.split('-'); // e.g., [synth123, volume]
    // Correctly identify control type even with multiple hyphens
    const controlIdentifier = target.id.replace(`${instanceId}-`, ''); // e.g., volume, lfo-rate

    switch(controlIdentifier) {
        case 'volume':
            handleVolumeChangeLogic(instanceId, target.value, target);
            break;
        case 'attack':
        case 'decay':
        case 'sustain':
        case 'release':
             const param = target.dataset.param; // For envelope parts
             if (param) handleEnvelopeChangeLogic(instanceId, param, target.value, target);
             // Check if it's reverb decay specifically
             else if (target.id.includes('-reverb-decay')) { 
                 handleReverbDecayChangeLogic(instanceId, target.value, target);
             }
             break;
        case 'note-duration': // Changed from 'duration' to match ID
             handleNoteDurationChangeLogic(instanceId, target.value, target);
             break;
        case 'pitch':
            handlePitchChangeLogic(instanceId, target.value, target);
            break;
        case 'delay-time': // Changed from 'time'
             handleDelayTimeChangeLogic(instanceId, target.value, target);
             break;
        case 'delay-feedback': // Changed from 'feedback'
             handleDelayFeedbackChangeLogic(instanceId, target.value, target);
             break;
        case 'delay-wet': // Changed from 'wet'
             handleDelayWetChangeLogic(instanceId, target.value, target);
             break;
         case 'reverb-wet': // Changed from 'wet'
             handleReverbWetChangeLogic(instanceId, target.value, target);
             break;
        // <<< ADDED: LFO Controls >>>
        case 'lfo-rate':
            handleLfoRateChangeLogic(instanceId, target.value, target);
            break;
        case 'lfo-depth':
            handleLfoDepthChangeLogic(instanceId, target.value, target);
            break;
        // <<< END ADDITION >>>
        default:
             // console.log("Unhandled range input:", target.id, controlIdentifier);
             break;
    }
};

// --- Logic Functions (Separated from direct event handling) ---

function findInstance(instanceId) {
    const instance = activeSynths.find(s => s.id === instanceId);
    if (!instance) {
        console.warn(`Could not find synth instance ${instanceId}`);
    }
    return instance;
}

const handleMuteLogic = (instanceId, buttonElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    instance.settings.muted = !instance.settings.muted;
    buttonElement.innerHTML = instance.settings.muted ? svgIconMuted : svgIconUnmuted; 
    console.log(`Instance ${instanceId} mute toggled to: ${instance.settings.muted}`);
    
    // Update Tone object: Mute/unmute the synth's volume
    if (instance.toneObjects?.synth?.volume) {
        const targetVolume = instance.settings.muted ? -Infinity : instance.settings.volume;
        // Disconnect LFO from volume BEFORE setting to -Infinity if muted
        if (instance.settings.muted && instance.settings.lfo.destination === 'volume') {
             try { instance.toneObjects.lfo.disconnect(instance.toneObjects.synth.volume); } catch(e){}
        }
        
        // Use rampTo for smoother transition, except when unmuting FROM LFO mod
        // If unmuting and LFO targets volume, connectLFO will handle setting the correct LFO range
        if (!instance.settings.muted && instance.settings.lfo.destination === 'volume') {
             connectLFO(instance); // Reconnect LFO which sets min/max correctly
        } else {
             // Otherwise, just ramp to the target base volume or -Infinity
            instance.toneObjects.synth.volume.value = targetVolume; // Set directly might be better for mute/unmute
            // instance.toneObjects.synth.volume.rampTo(targetVolume, 0.01); // Very short ramp
        }
    }
};

const handleCloseLogic = (instanceId, synthElement) => {
    const index = activeSynths.findIndex(s => s.id === instanceId);
    if (index > -1) {
        console.log(`Removing synth instance ${instanceId}`);
        disposeSynth(instanceId); // <<< Call disposeSynth for the instance
        activeSynths.splice(index, 1); 
        synthElement.remove(); 
        console.log("Active synths after close:", activeSynths);
    } else {
        console.warn(`Could not find synth instance ${instanceId} to remove.`);
    }
};

const handleTypeChangeLogic = (instanceId, selectedType, selectElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;

    const oldType = instance.config.type;
    const synthElement = document.querySelector(`.mini-synth[data-instance-id="${instanceId}"]`);

    console.log(`Type changed for ${instanceId} from ${oldType} to ${selectedType}`);
    instance.config.type = selectedType || null;
    instance.config.subtype = null; // Reset subtype
    instance.config.parameters = {}; // Reset parameters

    // Update CSS class on the synth element 
    if (synthElement) {
        if (oldType) {
            synthElement.classList.remove(`synth-${oldType}`);
        }
        if (instance.config.type) {
            synthElement.classList.add(`synth-${instance.config.type}`);
        }
    }

    updateSubtypeDropdown(instanceId, selectedType); 
    renderParameterArea(instanceId, selectedType, null); 
};

const handleSubtypeChangeLogic = (instanceId, selectedSubtype, selectElement) => {
    const instance = findInstance(instanceId);
    if (!instance || !instance.config.type) return;

    console.log(`Subtype changed for ${instanceId} to ${selectedSubtype}`);
    instance.config.subtype = selectedSubtype || null;
    instance.config.parameters = {}; // Reset parameters on subtype change

    renderParameterArea(instanceId, instance.config.type, selectedSubtype); // Re-render param area
};

const handleWaveformChangeLogic = (instanceId, waveform) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    instance.settings.oscillator.type = waveform;
    console.log(`Instance ${instanceId} waveform changed to: ${waveform}`);
    // Update Tone object using set
    instance.toneObjects?.synth?.oscillator?.set({ type: waveform });
};

const handleSequenceChangeLogic = (instanceId, index, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance || index === undefined || index < 0 || index > 7) return;
    
    const value = parseInt(valueStr, 10);
    // Default to 0 if invalid, then clamp
    const clampedValue = isNaN(value) ? 0 : Math.max(-24, Math.min(24, value));
    
    // Update UI only if the parsed/clamped value is different from input's current value
    if (inputElement && parseInt(inputElement.value, 10) !== clampedValue) {
        console.log(`Clamping sequence input ${index} for ${instanceId} from ${valueStr} to ${clampedValue}`);
        inputElement.value = clampedValue; 
    }
    
    // Update state only if the value actually changed
    if (instance.settings.sequence[index] !== clampedValue) {
        instance.settings.sequence[index] = clampedValue;
        console.log(`Instance ${instanceId} sequence[${index}] updated to: ${clampedValue}`);
    }
};

// --- Parameter Area Logic ---
const handleParameterChangeLogic = (instanceId, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance || !instance.config.type || !instance.config.subtype) return;

    const paramType = inputElement.dataset.paramType; 
    let value = inputElement.value.trim();

    if (inputElement.type === 'number') {
        // Allow empty string to represent null/cleared value for optional numbers
        value = value === '' ? null : parseFloat(value);
        // Basic validation for number types
        if (value !== null && isNaN(value)) {
            console.warn(`Invalid number input for ${paramType} on ${instanceId}: ${inputElement.value}`);
            // Optional: reset UI or prevent update? For now, allow NaN to be stored briefly.
            value = null; // Or revert to previous? For simplicity, set null
        }
    }
    
    if (!paramType) {
        console.warn("Missing data-param-type on parameter input:", inputElement);
        return;
    }

    console.log(`Param ${paramType} for ${instanceId} (${instance.config.subtype}) changed to:`, value);
    instance.config.parameters[paramType] = value;
};

const handleKeyregToggleLogic = (instanceId, buttonElement) => {
    const instance = findInstance(instanceId);
     if (!instance || instance.config.type !== 'keyreg') return;
     
     // Determine current state (online/offline) - could be stored or inferred
     const currentState = instance.config.subtype || 'online'; // Default to online?
     const newState = currentState === 'online' ? 'offline' : 'online';

     console.log(`Toggling Keyreg for ${instanceId} from ${currentState} to ${newState}`);
     
     // Update instance state
     instance.config.subtype = newState;
     // Update parameters if needed (e.g., set a boolean parameter)
     instance.config.parameters['state'] = newState; // Example parameter

     // Update button appearance/text
     buttonElement.textContent = `Set ${newState === 'online' ? 'Offline' : 'Online'}`;
     buttonElement.dataset.state = newState;
     
     // Update the main subtype dropdown to reflect the change
     const subtypeSelect = document.querySelector(`.subtype-select[data-instance-id="${instanceId}"]`);
     if (subtypeSelect) {
         subtypeSelect.value = newState; 
     }
 };

// --- Tone.js Control Logic Functions ---

const handleVolumeChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.volume = value;
    const display = document.getElementById(`${instanceId}-volume-value`);
    if (display) display.textContent = `${value.toFixed(1)} dB`;
    // Update Tone object (only if not muted)
    if (!instance.settings.muted && instance.toneObjects?.synth?.volume) {
        instance.toneObjects.synth.volume.rampTo(value, 0.02); // Short ramp
    }
};

const handleEnvelopeChangeLogic = (instanceId, param, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance || !param) return;
    const value = parseFloat(valueStr);
    instance.settings.envelope[param] = value;
    // Update Tone object using set for envelope parameters
    instance.toneObjects?.synth?.envelope?.set({ [param]: value });
};

const handleNoteDurationChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.noteDuration = value;
    const display = document.getElementById(`${instanceId}-note-duration-value`);
    if (display) display.textContent = `${value.toFixed(2)}s`;
    // NoteDuration is used in playTransactionSound, no direct Tone object update here
};

const handlePitchChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseInt(valueStr, 10);
    instance.settings.pitch = value;
    const display = document.getElementById(`${instanceId}-pitch-value`);
    if (display) display.textContent = value.toString();
     // Pitch is used in playTransactionSound, no direct Tone object update here
};

const handleDelayTimeChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.delay.time = value;
    const display = document.getElementById(`${instanceId}-delay-time-value`);
    if (display) display.textContent = `${value.toFixed(2)}s`;
    // Update Tone object
    instance.toneObjects?.delay?.delayTime?.rampTo(value, 0.02);
};

const handleDelayFeedbackChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.delay.feedback = value;
    const display = document.getElementById(`${instanceId}-delay-feedback-value`);
    if (display) display.textContent = value.toFixed(2);
    // Update Tone object
    instance.toneObjects?.delay?.feedback?.rampTo(value, 0.02);
};

const handleDelayWetChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.delay.wet = value;
    const display = document.getElementById(`${instanceId}-delay-wet-value`);
    if (display) display.textContent = value.toFixed(2);
    // Update Tone object
    instance.toneObjects?.delay?.wet?.rampTo(value, 0.02);
};

const handleReverbDecayChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.reverb.decay = value;
    const display = document.getElementById(`${instanceId}-reverb-decay-value`);
    if (display) display.textContent = `${value.toFixed(2)}s`;
    // Update Tone object (set directly as rampTo might not work well)
    if (instance.toneObjects?.reverb) {
        instance.toneObjects.reverb.decay = Math.max(0.1, value); // Ensure minimum decay > 0
    }
};

const handleReverbWetChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.reverb.wet = value;
    const display = document.getElementById(`${instanceId}-reverb-wet-value`);
    if (display) display.textContent = value.toFixed(2);
    // Update Tone object
    instance.toneObjects?.reverb?.wet?.rampTo(value, 0.02);
};

// --- Base Note / Octave Logic ---
const handleBaseNoteChangeLogic = (instanceId, direction) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    
    const currentNoteWithOctave = instance.settings.baseNote;
    let noteName = '';
    let octave = defaultOctave;
    const match = currentNoteWithOctave.match(/^([A-G]#?)([0-9])$/);
    if (match) {
        noteName = match[1];
        octave = parseInt(match[2], 10);
    } else {
        console.error(`Cannot parse base note: ${currentNoteWithOctave}`);
        return; 
    }

    let currentIndex = chromaticScale.indexOf(noteName);
    if (currentIndex === -1) {
         console.error(`Cannot find note ${noteName} in scale`);
        return; 
    }

    let newIndex = (currentIndex + direction + chromaticScale.length) % chromaticScale.length;
    const newNoteName = chromaticScale[newIndex];
    const newBaseNote = `${newNoteName}${octave}`;

    instance.settings.baseNote = newBaseNote;
    const displayEl = document.getElementById(`${instanceId}-base-note-display`);
    if (displayEl) displayEl.textContent = newBaseNote;
    // console.log(`Instance ${instanceId} base note changed to: ${newBaseNote}`);

    // <<< ADDED: Update LFO if targeting pitch >>>
    if (instance.settings.lfo.destination === 'pitch') {
        connectLFO(instance);
    }
    // <<< END ADDITION >>>
};

const handleOctaveChangeLogic = (instanceId, direction) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    
    const currentNoteWithOctave = instance.settings.baseNote;
    const minOctave = 0;
    const maxOctave = 8;
    const match = currentNoteWithOctave.match(/^([A-G]#?)([0-9])$/);
    if (match) {
        const noteName = match[1];
        let octave = parseInt(match[2], 10);
        let newOctave = octave + direction;
        newOctave = Math.max(minOctave, Math.min(maxOctave, newOctave));
        if (newOctave !== octave) {
            const newBaseNote = `${noteName}${newOctave}`;
            instance.settings.baseNote = newBaseNote;
            const displayEl = document.getElementById(`${instanceId}-base-note-display`);
            if (displayEl) displayEl.textContent = newBaseNote;
            // console.log(`Instance ${instanceId} octave changed to: ${newOctave}`);

            // <<< ADDED: Update LFO if targeting pitch >>>
            if (instance.settings.lfo.destination === 'pitch') {
                connectLFO(instance);
            }
            // <<< END ADDITION >>>
        }
    } else {
         console.error(`Cannot parse base note for octave change: ${currentNoteWithOctave}`);
    }
};

// --- Helpers for Dynamic UI --- 

// updateSubtypeDropdown - Needs slight adaptation to use instanceId
function updateSubtypeDropdown(instanceId, selectedType) {
    const subtypeSelect = document.querySelector(`.subtype-select[data-instance-id="${instanceId}"]`);
    if (!subtypeSelect) return;
    subtypeSelect.innerHTML = '<option value="">Sub</option>'; // Clear existing
    if (selectedType && granularityRules[selectedType]) {
        granularityRules[selectedType].forEach(rule => {
            const option = document.createElement('option');
            option.value = rule.subtype;
            option.textContent = rule.subtype; 
            subtypeSelect.appendChild(option);
        });
    }
}

// <<< MODIFIED: renderParameterArea handles keyreg toggle better AND adds Label >>>
function renderParameterArea(instanceId, type, subtype) {
    const paramArea = document.getElementById(`params-${instanceId}`);
    if (!paramArea) return;
    paramArea.innerHTML = ''; // Clear existing
    const instance = findInstance(instanceId); // Needed for current values
    if (!instance) return;

    let paramHTML = ''; // Start with empty HTML
 
    if (!type || !subtype) {
        // If no type/subtype, just show the label input
        paramArea.innerHTML = paramHTML; // Set the HTML containing only the label
        return;
    }
    const rule = granularityRules[type]?.find(r => r.subtype === subtype);

    if (!rule) { // Rule not found for subtype
        // Append message to the existing paramHTML (which has the label)
        paramHTML += '<div class="param-control"><span class="no-params">Invalid subtype selected?</span></div>';
        paramArea.innerHTML = paramHTML;
        return;
    }

    // --- Check if Label is needed for this subtype ---
    const identifyingParamTypes = ['address', 'asset-id', 'app-id', 'manager-address', 'sender', 'receiver', 'aclose'];
    const showLabelInput = rule.params && rule.params.some(p => identifyingParamTypes.includes(p));

    // --- Generate Label HTML *if needed* ---
    if (showLabelInput) {
        const currentLabel = instance.config.parameters?.label ?? '';
        paramHTML += `
            <div class="param-control">
                <label for="${instanceId}-param-label">Label:</label>
                <input type="text" id="${instanceId}-param-label" name="label" class="param-input text-input" placeholder="(Optional Name)" data-instance-id="${instanceId}" data-param-type="label" value="${currentLabel}">
            </div>
        `;
    }

    // --- Generate other parameters ---

    // Handle cases with no standard input parameters first
    if (!rule.params || rule.params.length === 0) {
         // Append message (Label was already potentially added)
        paramHTML += '<div class="param-control"><span class="no-params">No parameters needed.</span></div>';
        paramArea.innerHTML = paramHTML;
        return;
    }

    // Handle specific parameter types defined in the rule
    if (rule.params.includes('toggle')) { // Special case for keyreg online/offline
         const currentState = instance.config.subtype || 'online';
         const buttonText = `Set ${currentState === 'online' ? 'Offline' : 'Online'}`;
         // Append toggle button HTML to paramHTML
         paramHTML += `<div class="param-control">
                            <button class="keyreg-toggle" data-instance-id="${instanceId}" data-state="${currentState}">${buttonText}</button>
                         </div>`;
         paramArea.innerHTML = paramHTML; // Set HTML with label + button
         return; // Stop here for toggle type
    }

    // Generate standard input fields and append them to paramHTML
    rule.params.forEach(param => {
        const inputId = `${instanceId}-${subtype}-${param}`;
        const label = param.replace(/-/g, ' ').replace(/\b\\w/g, l => l.toUpperCase());
        const currentValue = instance.config.parameters?.[param] ?? '';

        // Append the specific parameter control HTML
        if (param === 'min' || param === 'max') {
            paramHTML += `
                <div class="param-control">
                    <label for="${inputId}">${label}:</label>
                    <input type="number" id="${inputId}" name="${param}" class="param-input number-input" data-instance-id="${instanceId}" data-param-type="${param}" value="${currentValue}">
                </div>`;
        } else { // address, asset-id, app-id, manager-address etc.
             paramHTML += `
                <div class="param-control">
                    <label for="${inputId}">${label}:</label>
                    <input type="text" id="${inputId}" name="${param}" class="param-input text-input" data-instance-id="${instanceId}" data-param-type="${param}" value="${currentValue}">
                </div>`;
        }
    });
    // Set the final HTML containing the label + all specific parameters
    paramArea.innerHTML = paramHTML;
}

// <<< Remove or comment out old individual handlers >>>
/*
const handleMuteClick = (e) => { ... }; // Now handleMuteLogic
const handleCloseClick = (e) => { ... }; // Now handleCloseLogic
const handleEnvelopeChange = (e) => { ... }; // Now handleEnvelopeChangeLogic
const handleWaveformChange = (e) => { ... }; // Now handleWaveformChangeLogic
const handlePitchChange = (e) => { ... }; // Now handlePitchChangeLogic
const handleNoteDurationChange = (e) => { ... }; // Now handleNoteDurationChangeLogic
const handleDelayTimeChange = (e) => { ... }; // Now handleDelayTimeChangeLogic
const handleDelayFeedbackChange = (e) => { ... }; // Now handleDelayFeedbackChangeLogic
const handleDelayWetChange = (e) => { ... }; // Now handleDelayWetChangeLogic
const handleReverbDecayChange = (e) => { ... }; // Now handleReverbDecayChangeLogic
const handleReverbWetChange = (e) => { ... }; // Now handleReverbWetChangeLogic
const handleBaseNoteDownClick = (e) => { ... }; // Combined into handleBaseNoteChangeLogic
const handleBaseNoteUpClick = (e) => { ... }; // Combined into handleBaseNoteChangeLogic
const handleOctaveDownClick = (e) => { ... }; // Combined into handleOctaveChangeLogic
const handleOctaveUpClick = (e) => { ... }; // Combined into handleOctaveChangeLogic
const handleVolumeChange = (e) => { ... }; // Now handleVolumeChangeLogic
const handleSequenceChange = (e) => { ... }; // Now handleSequenceChangeLogic
*/

// <<< Placeholder/TODO for functions that need rewrite >>>
const updateAllValueDisplays = () => { /* console.warn("TODO: Implement updateAllValueDisplays"); */ };
const updateAllSequencerDisplays = () => { /* console.warn("TODO: Implement updateAllSequencerDisplays"); */ };
/*
const playTransactionSound = (synthInstance, index = 0) => { }; 
const initAudio = async () => { };
const disposeSynth = (instanceId) => { };
const savePreset = () => { };
const loadPreset = async () => { };
*/

// Corrected injectSliderStyles function
const injectSliderStyles = () => {
    // This function is kept for potential future use,
    // but the main styles for .seq-input are now in proto-synth.html
    // We can leave the CSS string empty or add other non-conflicting styles here.
    const css = `
    /* Base styles for range inputs - These might still be useful here */
    input[type='range'] {
        -webkit-appearance: none; /* Override default look */
        appearance: none;
        width: 100%; /* Full width */
        height: 5px; /* Specified height */
        background: #003333; /* Dark track */
      outline: none;
        opacity: 0.9;
        transition: opacity .15s ease-in-out;
        border-radius: 2px;
        margin: 3px 0; /* Add some vertical margin */
    }

    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
        appearance: none;
        width: 10px; /* Thumb width */
        height: 14px; /* Thumb height */
        background: #009999; /* Teal thumb */
        border-radius: 2px; /* Slightly rounded */
      cursor: pointer;
    }

    input[type='range']::-moz-range-thumb {
        width: 10px;
        height: 14px;
        background: #009999;
        border-radius: 2px;
        cursor: pointer;
        border: none; /* Remove default border */
    }
    /* Add any other styles previously injected here that AREN'T .seq-input */
    `;
    const style = document.createElement('style');
    // Only add if there's content
    if (css.trim()) {
        style.textContent = css;
        document.head.appendChild(style);
    }
};

// <<< ADDED: LFO Logic Functions >>>

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
            const delayModRangeSec = 0.25; // Modulate by +/- 0.25 seconds
             return delayModRangeSec * depth;
        default:
            return 0; // No modulation
    }
}

// Helper function to connect/disconnect LFO based on settings
function connectLFO(instance) {
    if (!instance?.toneObjects?.lfo || !instance.toneObjects.synth || !instance.toneObjects.delay) {
        console.warn(`Cannot connect LFO for ${instance.id}, Tone objects not ready.`);
        return;
    }

    const { lfo, synth, delay } = instance.toneObjects;
    const { destination, depth } = instance.settings.lfo;
    const { baseNote } = instance.settings; // Needed for pitch base freq
    const { volume: baseVolume } = instance.settings; // Needed for volume base level
    const { time: baseDelayTime } = instance.settings.delay; // Needed for delay base time

    // --- Disconnect from all potential targets first ---
    try {
         lfo.disconnect(synth.oscillator.frequency);
         lfo.disconnect(synth.volume);
         lfo.disconnect(delay.delayTime);
    } catch (e) { /* Ignore errors if not connected */ }

    // --- Set amplitude based on depth (if depth is 0, amplitude is 0) ---
    const scaledModulationAmount = scaleLfoDepth(destination, depth, 0); // Base value isn't strictly needed for range scaling here
    
    // The LFO's amplitude controls the *amount* of modulation.
    // The LFO's min/max determine the *range* it oscillates over relative to the target's base value.
    lfo.amplitude.value = depth > 0 ? 1 : 0; // LFO active only if depth > 0

    if (depth === 0 || destination === 'none') {
        console.log(`LFO ${instance.id}: Disconnected or depth is 0.`);
        lfo.min = 0; // Reset min/max when inactive
        lfo.max = 0; 
        return; // Exit if no destination or zero depth
    }

    // --- Connect to the new target and set min/max based on scaled depth ---
    console.log(`LFO ${instance.id}: Connecting to ${destination}, Depth: ${depth}, ScaledMod: ${scaledModulationAmount.toFixed(2)}`);
    
    try {
        switch(destination) {
            case 'pitch':
                // Target parameter is frequency in Hz
                const baseFreq = Tone.Frequency(baseNote).toFrequency();
                // Modulate frequency directly. Calculate min/max Hz based on cents modulation.
                 // Convert cents modulation to frequency ratio: ratio = 2^(cents / 1200)
                 const ratio = Math.pow(2, scaledModulationAmount / 1200);
                 lfo.min = baseFreq / ratio;
                 lfo.max = baseFreq * ratio;
                 lfo.connect(synth.oscillator.frequency);
                 break;
            case 'volume':
                // Target parameter is volume in dB. Modulate around the base volume.
                lfo.min = baseVolume - scaledModulationAmount;
                 lfo.max = baseVolume + scaledModulationAmount;
                 // Only connect if synth is not muted globally by the mute button!
                 if (!instance.settings.muted) {
                     lfo.connect(synth.volume);
                 }
                 break;
            case 'delayTime':
                // Target parameter is delayTime in seconds. Modulate around base delay time.
                 // Clamp modulation to avoid negative delay time.
                 lfo.min = Math.max(0.001, baseDelayTime - scaledModulationAmount); // Ensure min is slightly above 0
                 lfo.max = baseDelayTime + scaledModulationAmount;
                 lfo.connect(delay.delayTime);
                 break;
        }
    } catch (error) {
         console.error(`Error connecting LFO for ${instance.id} to ${destination}:`, error);
    }
}


const handleLfoRateChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr);
    instance.settings.lfo.rate = value;
    const display = document.getElementById(`${instanceId}-lfo-rate-value`);
    if (display) display.textContent = `${value.toFixed(1)} Hz`;
    // Update Tone object
    instance.toneObjects?.lfo?.set({ frequency: value });
};

const handleLfoDepthChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = parseFloat(valueStr); // Depth is 0-100
    instance.settings.lfo.depth = value;
    const display = document.getElementById(`${instanceId}-lfo-depth-value`);
    if (display) display.textContent = value.toFixed(0);
    // Reconnect LFO to apply new depth scaling and amplitude
    connectLFO(instance); 
};

const handleLfoWaveformChangeLogic = (instanceId, waveform) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    instance.settings.lfo.waveform = waveform;
    // Update Tone object
    instance.toneObjects?.lfo?.set({ type: waveform });
};

const handleLfoDestinationChangeLogic = (instanceId, destination) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    instance.settings.lfo.destination = destination;
    // Reconnect LFO to the new destination
    connectLFO(instance); 
};