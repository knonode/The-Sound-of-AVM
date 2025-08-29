// Global error handler for debugging
window.addEventListener('error', (event) => {
    console.error('🚨 Global JavaScript Error:', event.error);
    console.error('🚨 Error message:', event.message);
    console.error('🚨 Error filename:', event.filename);
    console.error('🚨 Error line:', event.lineno);
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
    console.error('🚨 Unhandled Promise Rejection:', event.reason);
});

import AlgorandAPI from './algorand-api.js';
import {
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
    scaleLfoDepth,
    synthsInitialized,
    isMasterMuted,
    masterVolumeBeforeMute
} from './tone-synthesis.js';

// UI and application state (non-synthesis)
let isPlaying = false;
let transactionCount = 0;
let txTypeCounts = {};
let persistentTotalTxs = 0;
let persistentTotalBlocks = 0;
let lastProcessedRound = null;
let apiMode = 'nodely';

// Replace the old apiMode variable (line 10)
let currentMempoolMode = 'algoranding'; // Default to algoranding for mempool
let currentBlockMode = 'nodely'; // Always use nodely for blocks

let activeSynths = [];

// Define the chromatic scale for cycling
const chromaticScale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const defaultOctave = 4;

function getDefaultInstanceSettings() {
    return {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
        volume: -8,
        muted: false,
        savedVolume: null,
        mutedByMaster: false,
        pitch: 0,
        delay: { time: 0, feedback: 0, wet: 0 },
        reverb: { roomSize: 0.5, wet: 0.3 },
        lfo: {
            rate: 5, // Hz
            depth: 0, // 0-100 scale, initially off
            waveform: 'sine',
            destination: 'none' // 'none', 'pitch', 'volume', 'delayTime'
        },
        noteDuration: 0.1,
        baseNote: `A${defaultOctave}`,
        sequence: [0, 0, 0, 0, 0, 0, 0, 0],
        currentStepIndex: 0
    };
}

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
  ],
  reward: [
    { subtype: 'proposer', field: 'rcv', params: ['address'], description: 'Block proposer address' },
    { subtype: 'amount', field: 'amt', params: ['min', 'max'], description: 'Reward amount range' }
  ],
  block: [
    // Remove the subtypes - leave empty array or just one simple option
  ]
};
// Get main types for easy access
const mainTxTypes = Object.keys(granularityRules);


function initializeTypeCounts() {
    txTypeCounts = {}; // Reset
    mainTxTypes.forEach(type => {
        txTypeCounts[type] = 0;
    });
    updateTypeCountsDisplay();
}

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

    // --- Generate Tone.js Controls HTML ---
    const controlsHTML = `
        <!-- Volume Section -->
        <div class="volume-section">
            <div class="control-row">
                <span class="control-label">Volume: <span id="${uniqueId}-volume-value">${currentVolume.toFixed(1)} dB</span></span>
            </div>
            <div class="control-row">
                <input type="range" id="${uniqueId}-volume" min="-24" max="3" step="0.5" value="${currentVolume}" data-instance-id="${uniqueId}">
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
                <select id="${uniqueId}-waveform" class="waveform-select compact-select" data-instance-id="${uniqueId}">
                    <option value="sine" ${settings.oscillator.type === 'sine' ? 'selected' : ''}>Sine</option>
                    <option value="square" ${settings.oscillator.type === 'square' ? 'selected' : ''}>Square</option>
                    <option value="triangle" ${settings.oscillator.type === 'triangle' ? 'selected' : ''}>Triangle</option>
                    <option value="sawtooth" ${settings.oscillator.type === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
                </select>
            </div>
        </div>

        <!-- Pitch Section (NEW) -->
        <div class="pitch-section">
            <div class="control-row"> <span class="control-label">Pitch: <span id="${uniqueId}-pitch-value">${settings.pitch}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-pitch" min="-12" max="12" step="1" value="${settings.pitch}" data-instance-id="${uniqueId}"> </div>
        </div>

        <!-- Delay Section (was Effect Controls) -->
        <div class="delay-section">
            <div class="control-row"> <span class="control-label">Delay Time: <span id="${uniqueId}-delay-time-value">${settings.delay.time.toFixed(2)}s</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-delay-time" min="0" max="1" step="0.01" value="${settings.delay.time}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Feedback: <span id="${uniqueId}-delay-feedback-value">${settings.delay.feedback.toFixed(2)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-delay-feedback" min="0" max="0.9" step="0.01" value="${settings.delay.feedback}" data-instance-id="${uniqueId}"> </div>
            <div class="control-row"> <span class="control-label">Delay Wet: <span id="${uniqueId}-delay-wet-value">${settings.delay.wet.toFixed(2)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-delay-wet" min="0" max="1" step="0.01" value="${settings.delay.wet}" data-instance-id="${uniqueId}"> </div>
        </div>

        <!-- Reverb Section -->
        <div class="reverb-section">
            <div class="control-row"> <span class="control-label">Room Size: <span id="${uniqueId}-reverb-size-value">${(settings.reverb.roomSize ?? Math.max(0.05, Math.min(0.95, ((settings.reverb.decay ?? 1.5) / 10)))).toFixed(2)}</span></span> </div>
            <div class="control-row"> <input type="range" id="${uniqueId}-reverb-size" min="0" max="1" step="0.01" value="${(settings.reverb.roomSize ?? Math.max(0.05, Math.min(0.95, ((settings.reverb.decay ?? 1.5) / 10))))}" data-instance-id="${uniqueId}"> </div>
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

// <<< NEW: Function to generate the HTML for the Master Synth controller >>>
const createMasterSynthHTML = () => {
    const uniqueId = 'master'; // A fixed ID for the master controls

    const headerHTML = `
        <div class="synth-header">
            <select class="type-select" disabled><option>MASTER</option></select>
            <select class="subtype-select" disabled><option>FX</option></select>
            <button class="mute-btn" data-instance-id="${uniqueId}" title="Mute/Unmute All">${svgIconUnmuted}</button>
            <button class="close-btn" data-instance-id="${uniqueId}" title="Master cannot be removed" disabled>×</button>
        </div>
    `;

    const parameterAreaHTML = `<div class="parameter-area" id="params-${uniqueId}"></div>`;

    const controlsHTML = `
        <!-- Master Volume Section -->
        <div class="volume-section">
            <div class="control-row">
                <span class="control-label">Master Volume: <span id="${uniqueId}-volume-value">-3.0 dB</span></span>
            </div>
            <div class="control-row">
                <input type="range" id="${uniqueId}-volume" min="-24" max="3" step="0.5" value="-3.0" data-instance-id="${uniqueId}">
            </div>
        </div>

        <!-- Compressor Section -->
        <div class="compressor-section">
            <span class="control-label">Compressor</span>
            <div class="control-row"><span class="control-label">Threshold: <span id="${uniqueId}-comp-thresh-val">-24 dB</span></span></div>
            <div class="control-row"><input type="range" id="${uniqueId}-comp-thresh" min="-60" max="0" value="-24" data-instance-id="${uniqueId}"></div>
            <div class="control-row"><span class="control-label">Ratio: <span id="${uniqueId}-comp-ratio-val">4:1</span></span></div>
            <div class="control-row"><input type="range" id="${uniqueId}-comp-ratio" min="1" max="20" value="4" data-instance-id="${uniqueId}"></div>
        </div>

        <!-- 3-Band EQ Section -->
        <div class="eq-section">
            <span class="control-label">3-Band EQ</span>
            <div class="control-row"><span class="control-label">Low: <span id="${uniqueId}-eq-low-val">0 dB</span></span></div>
            <div class="control-row"><input type="range" id="${uniqueId}-eq-low" min="-12" max="12" value="0" data-instance-id="${uniqueId}"></div>
            <div class="control-row"><span class="control-label">Mid: <span id="${uniqueId}-eq-mid-val">0 dB</span></span></div>
            <div class="control-row"><input type="range" id="${uniqueId}-eq-mid" min="-12" max="12" value="0" data-instance-id="${uniqueId}"></div>
            <div class="control-row"><span class="control-label">High: <span id="${uniqueId}-eq-high-val">0 dB</span></span></div>
            <div class="control-row"><input type="range" id="${uniqueId}-eq-high" min="-12" max="12" value="0" data-instance-id="${uniqueId}"></div>
        </div>

        <!-- Limiter Section -->
        <div class="limiter-section">
            <span class="control-label">Limiter</span>
            <div class="control-row"><span class="control-label">Threshold: <span id="${uniqueId}-limit-thresh-val">-2.0 dB</span></span></div>
            <div class="control-row"><input type="range" id="${uniqueId}-limit-thresh" min="-6" max="-2" step="0.1" value="-2" data-instance-id="${uniqueId}"></div>
        </div>
    `;

    const fullHTML = `
        <div class="mini-synth master-synth" data-instance-id="${uniqueId}">
            ${headerHTML}
            ${parameterAreaHTML}
            ${controlsHTML}
        </div>
    `;
    return fullHTML;
};

// initAudio function moved to tone-synthesis.js

// initializeToneForInstance function moved to tone-synthesis.js

// disposeSynth function moved to tone-synthesis.js
// UI-specific cleanup (state proof countdown) is handled separately

// <<< SIMPLE STATE PROOF TIMER (v2) >>>
let currentRound = 0; // maintained by block handler elsewhere

const STATE_PROOF_INTERVAL            = 256; // full distance between state-proof blocks
const STATE_PROOF_COLLECTION_OFFSET   = 135; // rounds between spt.n and first stpf tx

// Finite-state machine:  'INIT' → 'COUNTING' → 'AWAIT_TX'
let spState             = 'INIT';             // current phase
let nextCollectionStart = 0;                  // authoritative spt.n from header
let targetRound         = 0;                  // nextCollectionStart + 135

function updateStpfDisplays(count) {
    activeSynths.filter(s => s.config.type === 'stpf').forEach(s => {
        const el = document.getElementById(`${s.id}-stpf-countdown`);
        if (el) el.textContent = count.toString();
    });
}

function onNewBlock(blockRound, sptNFromHeader) {
    currentRound = blockRound;

    switch (spState) {
        case 'INIT': {
            nextCollectionStart = sptNFromHeader || blockRound; // fallback if header empty
            while (nextCollectionStart + STATE_PROOF_COLLECTION_OFFSET <= currentRound) {
                nextCollectionStart += STATE_PROOF_INTERVAL; // we connected mid-cycle
            }
            targetRound = nextCollectionStart + STATE_PROOF_COLLECTION_OFFSET;
            spState     = 'COUNTING';
            break;
        }
        case 'COUNTING': {
            if (currentRound >= targetRound) {
                spState = 'AWAIT_TX';
            }
            break;
        }
        case 'AWAIT_TX': {
            // header switches to NEXT cycle only after state-proof is included
            if (sptNFromHeader && sptNFromHeader !== nextCollectionStart) {
                nextCollectionStart = sptNFromHeader;
                targetRound         = nextCollectionStart + STATE_PROOF_COLLECTION_OFFSET;
                spState             = 'COUNTING';
            } else if (currentRound - targetRound > 50) { // safety auto-reset
                spState = 'INIT';
            }
            break;
        }
    }

    updateStpfDisplays(Math.max(0, targetRound - currentRound));
}

function onStpfTransaction() {
    if (spState === 'COUNTING' && currentRound >= targetRound) {
        spState = 'AWAIT_TX';
    }
}

// --- Compatibility shims for legacy calls elsewhere in code ---
function initializeStateProofCountdown() {/* deprecated in v2 */}
function stopStateProofCountdown() {/* deprecated in v2 */}


// Function to update current round displays for block synths
function updateCurrentRoundDisplays() {
    activeSynths.forEach(instance => {
        if (instance.config.type === 'block') {
            const roundElement = document.getElementById(`${instance.id}-current-round`);
            if (roundElement) {
                const displayRound = currentRound > 0 ? currentRound : 'N/A';
                roundElement.textContent = `${displayRound}`;
            }
        }
    });
}

// <<< NEW: Function to update state proof countdowns when rounds change >>>
function updateStateProofCountdowns() {/* deprecated in v2 */}

// <<< UPDATED: Transaction stream to reset countdown on stpf tx >>>
const startTransactionStream = async () => {
    // Try to initialize audio first (this will work after user clicks)
    if (!synthsInitialized) {
        console.log("Audio not initialized, attempting init...");
        await initAudio();
        if (!synthsInitialized) {
            alert('Audio could not be initialized. Please try clicking the button again.');
            return;
        }
    }

    // Ensure all active synths have Tone objects initialized
    for (const instance of activeSynths) {
        if (!instance.toneObjects) {
            console.log(`Initializing Tone for instance ${instance.id} before starting stream...`);
            await initializeToneForInstance(instance);
        }
    }

    // Reset counters
    transactionCount = 0;
    initializeTypeCounts();
    lastProcessedRound = null;
    // Reset sequence indices for all instances
    activeSynths.forEach(inst => inst.settings.currentStepIndex = 0);

    // <<< NEW: Initialize state proof countdowns for all stpf synths at play start >>>
    const stpfSynths = activeSynths.filter(instance => instance.config.type === 'stpf');
    for (const instance of stpfSynths) {
        await initializeStateProofCountdown(instance.id);
        console.log(`Initialized state proof countdown for ${instance.id}`);
    }

    isPlaying = true;
    updateStatus('Connecting to Algorand node...');

    const connected = await AlgorandAPI.initAlgodConnection();
    if (!connected) {
      console.error("Couldn't connect to Algorand node");
      updateStatus('Failed to connect to Algorand node');
      isPlaying = false;

      // Check if we're in user_node mode for better error message
      const currentModes = AlgorandAPI.getCurrentModes();
      if (currentModes.mempool === 'user_node' || currentModes.block === 'user_node') {
        alert('Could not connect to your local node. Remember: Your node connection only works on the same device/network. Try "Algoranding" or "Nodely" for remote access.');
      } else {
        alert('Could not connect to the Algorand node.');
      }
      return;
    }

    console.log("Connected to Algorand node - starting transaction polling");
    updateStatus('Connected - Streaming transactions');

    // Let AlgorandAPI select the proper cadence for the chosen provider
    AlgorandAPI.startPolling((txType, txData, index) => {
      if (!isPlaying) return;

    // --- Core Matching Logic ---
    const mainType = txType.split('-')[0]; // Get base type (e.g., 'pay', 'axfer')

    // <<< CORRECTED: Handle stpf transactions >>>
    if (mainType === 'stpf') {
        console.log(`📝 Stpf transaction detected in round ${txData.round || currentRound}`);

        // Notify state-proof timer
        onStpfTransaction();
    }

    // --- Update current round and state proof data ---
    if (txType === 'block' && txData.round) {
        // Feed state-proof timer with authoritative block data
        onNewBlock(txData.round, txData.nextStateProofRound);
        if (currentRound === 0) {
            currentRound = txData.round;
            console.log(`🔥 Initial currentRound set to: ${currentRound}`);

            // <<< NEW: Initialize countdowns immediately when we get the first round >>>
            const stpfSynths = activeSynths.filter(instance => instance.config.type === 'stpf');
            for (const instance of stpfSynths) {
                initializeStateProofCountdown(instance.id);
            }
        }
        // Always update the current round for subsequent blocks
        if (txData.round > currentRound) {
            console.log(`🔥 Updating currentRound from ${currentRound} to ${txData.round}`);
            currentRound = txData.round;



            // <<< NEW: Debug state proof data from block >>>
            console.log(`🔍 Block ${txData.round} state proof data:`, {
                nextStateProofRound: txData.nextStateProofRound,
                hasNextStateProofRound: txData.nextStateProofRound !== null && txData.nextStateProofRound !== undefined,
                isInFuture: txData.nextStateProofRound > txData.round,
                difference: txData.nextStateProofRound - txData.round
            });

            // <<< NEW: Store the next state proof round from block data >>>
            if (txData.nextStateProofRound && typeof txData.nextStateProofRound === 'number') {
                window.nextStateProofRound = txData.nextStateProofRound;
                console.log(`🔥 Updated nextStateProofRound to: ${window.nextStateProofRound}`);
            }

            // <<< UPDATED: Update state proof countdowns with actual data >>>
            updateStateProofCountdowns();
        }
    }

    // Always refresh displays with the latest data.
    // Delay round display update to ensure DOM is ready
    setTimeout(updateCurrentRoundDisplays, 10);

    // --- Update All Counters ---

    // 1. Session-based counters
    transactionCount++;
    if (txTypeCounts.hasOwnProperty(mainType)) {
        txTypeCounts[mainType]++;
      } else {
        txTypeCounts[mainType] = 1; // Count even if no synth is configured
      }

    // 2. Persistent counters
    if (mainType === 'block') {
        persistentTotalBlocks++;
        localStorage.setItem('persistentTotalBlocks', persistentTotalBlocks.toString());
    } else {
        // Assume anything that isn't a 'block' event is a transaction
        persistentTotalTxs++;
        localStorage.setItem('persistentTotalTxs', persistentTotalTxs.toString());
    }

    // --- Update All UI Displays ---
    const totalCountEl = document.getElementById('transaction-count');
    if (totalCountEl) totalCountEl.textContent = `${transactionCount} transactions processed`;
    updateTypeCountsDisplay();
    updatePersistentCountersDisplay();

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

    } else if (generalMatches.length > 0) {
        // If no specific match, but general matches exist, play the general ones
        instancesToPlay = generalMatches;
    } else {
        // No matches found for this type (specific check failed for all relevant subtypes)
        // console.log(`TX ${txType} - No specific or general matches found.`);
        // This case might occur if a type exists but all its specific subtypes fail the checkTransactionMatch
    }

    // Play sound for the selected instances (either specific or general)
    if (instancesToPlay.length > 0) {
        instancesToPlay.forEach((instance, matchIndex) => {
            // Always play UI effects (LEDs, sequencer) regardless of mute state
            // The mute check happens inside playTransactionSound to silence audio only
            if (instance.toneObjects) {
                 // Use matchIndex for slight time offset if multiple synths match same tx
                playTransactionSoundWithUI(instance, matchIndex * 0.010);
            }
        });
    }

   });    // Polling interval is chosen automatically
};

const stopTransactionStream = () => {
    isPlaying = false;
    AlgorandAPI.stopPolling();
    updateStatus('Stream stopped');

    // Stop all state proof countdowns
    Object.keys(stateProofCountdownIntervals).forEach(instanceId => {
        stopStateProofCountdown(instanceId);
    });

    // Reset LEDs and indicators
    document.querySelectorAll('.led.active').forEach(led => led.classList.remove('active'));
    document.querySelectorAll('.seq-indicator.active').forEach(ind => ind.classList.remove('active'));
};

// <<< Helper function to check if a transaction matches instance config >>>
function checkTransactionMatch(config, txData) {
    const { type, subtype, parameters } = config;

    // Handle block type specially - no subtype needed
    if (type === 'block') {
        return true; // Any block transaction triggers this
    }

    const rule = granularityRules[type]?.find(r => r.subtype === subtype);

    if (!rule) return false;

    // Ensure we have the transaction details, often nested under 'txn'
    const txn = txData?.txn ?? txData; // Handle both potential structures

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
            const targetAddress = parameters.address;

            // Enhanced debugging for pay-sender
            console.log('🔍 PAY-SENDER DEBUG:', {
                fullTxData: txData,
                txnObject: txn,
                senderFromTxn: snd,
                targetAddress: targetAddress,
                parametersObject: parameters,
                configObject: config,
                exactMatch: snd === targetAddress,
                senderExists: snd !== null && snd !== undefined,
                targetExists: targetAddress !== null && targetAddress !== undefined && targetAddress !== '',
                senderLength: snd?.length,
                targetLength: targetAddress?.length,
                senderType: typeof snd,
                targetType: typeof targetAddress
            });

            const result = snd === targetAddress;
            console.log(`PAY-SENDER RESULT: ${result} (${snd} === ${targetAddress})`);
            return result;
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

// <<< playTransactionSoundWithUI wraps synthesis module call with UI logic >>>
const playTransactionSoundWithUI = (instance, timeOffset = 0) => {
  const { id, settings } = instance;

  // --- SEQUENCER LOGIC ---
  const currentStep = settings.currentStepIndex ?? 0;
  const sequence = settings.sequence || [0, 0, 0, 0, 0, 0, 0, 0];
  const sequenceOffset = sequence[currentStep];
  // Advance step index for the next play *of this instance*
  instance.settings.currentStepIndex = (currentStep + 1) % 8;

  // Use synthesis module for audio generation (create a modified instance without UI logic)
  const audioInstance = { ...instance };
  // Remove UI-only properties that aren't needed for synthesis
  playTransactionSound(audioInstance, timeOffset); // Call imported function

  // Keep UI logic: Flash LED and Sequencer Indicator (with same offset)
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

// <<< Function to load a preset from a file or URL >>>
async function loadPresetFromSource(source) {
    let presetData;
    let presetName = '';

    try {
        if (typeof source === 'string') { // It's a URL
            presetName = source.split('/').pop(); // Get filename

            // Add cache-busting parameter
            const url = `/${source}?t=${Date.now()}`;
            const response = await fetch(url);

            const textContent = await response.text();

            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                throw new Error(`HTTP error! status: ${response.status}.`);
            }

            presetData = JSON.parse(textContent);

        } else if (source instanceof File) { // It's a File object from input
            presetName = source.name;
            const text = await source.text();
            presetData = JSON.parse(text);
        } else {
            throw new Error('Invalid source for preset loading.');
        }

        // --- Core Loading Logic ---
        if (!presetData.activeSynths || !Array.isArray(presetData.activeSynths)) {
            throw new Error('Preset file is missing "activeSynths" array.');
        }

        // Clear Current State - more surgically
        const regularSynths = activeSynths.filter(s => s.id !== 'master');
        regularSynths.forEach(instance => {
            // Handle UI-specific cleanup first
            stopStateProofCountdown(instance.id);
            // Then dispose synthesis objects
            disposeSynth(instance.id, activeSynths);
        });
        activeSynths = activeSynths.filter(s => s.id === 'master');

        const synthContainer = document.getElementById('synth-container');
        const regularSynthElements = synthContainer.querySelectorAll('.mini-synth:not(.master-synth)');
        regularSynthElements.forEach(el => el.remove());

        // Process Loaded Data
        let targetActiveSynths = presetData.activeSynths.map(loadedInstance => ({
            ...loadedInstance,
            settings: {
                ...getDefaultInstanceSettings(),
                ...(loadedInstance.settings || {})
            },
            toneObjects: null
        }));

        // Update State and Rebuild UI
        activeSynths.push(...targetActiveSynths);

        targetActiveSynths.forEach(instance => {
            synthContainer.innerHTML += createSynthHTML(instance);
            renderParameterArea(instance.id, instance.config.type, instance.config.subtype);
        });

        // Initialize Audio for New Instances
        if (!synthsInitialized) { await initAudio(); }
        for (const instance of targetActiveSynths) {
            await initializeToneForInstance(instance);
        }

        updateStatus(`Preset "${presetName}" loaded`);
        document.getElementById('load-preset-modal').style.display = 'none';

    } catch (error) {
        console.error(`Failed to load preset from ${presetName}:`, error);
        alert(`Error loading preset: ${error.message}`);
    }
}

// <<< Function to save the current layout from the top bar >>>
function savePresetLayout() {
    const nameInput = document.getElementById('new-preset-name');
    const presetName = nameInput.value.trim();
    if (!presetName) {
        alert('Please enter a preset name.');
        return;
    }

    const downloadToggle = document.getElementById('download-json-toggle');

    const presetData = {
        activeSynths: activeSynths.filter(instance => instance.id !== 'master').map(instance => ({
            id: instance.id,
            config: instance.config,
            settings: instance.settings
        }))
    };
    const jsonString = JSON.stringify(presetData, null, 4);

    // Save to Local Storage
    try {
        const presets = JSON.parse(localStorage.getItem('txSynthPresets') || '{}');
        presets[presetName] = presetData;
        localStorage.setItem('txSynthPresets', JSON.stringify(presets));
        updateStatus(`Preset "${presetName}" saved to My Presets`);

    // === Send compressed preset to parent window for NFT minting ===
    try {
        const compressed = btoa(unescape(encodeURIComponent(jsonString)));
        window.parent.postMessage({ type: 'PRESET_SAVED', preset: compressed }, '*');
    } catch (err) {
        console.error('Failed to post compressed preset to parent:', err);
    }
    } catch (error) {
        console.error("Error saving preset to Local Storage:", error);
        alert("Failed to save preset to Local Storage.");
    }

    // Download as JSON file if toggled
    if (downloadToggle.checked) {
        try {
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${presetName}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch(error) {
            console.error("Failed to download preset file:", error);
            alert("Could not download the file.");
        }
    }

    document.getElementById('save-preset-modal').style.display = 'none';
    nameInput.value = '';
    downloadToggle.checked = false;
}

// Listen for preset load messages from parent window
window.addEventListener('message', (e) => {
  if (e.data?.type === 'LOAD_PRESET_FROM_NFT') {
    console.log('🎵 Legacy synth received preset from NFT:', e.data.preset);
    try {
      // Load the preset directly into the synth
      loadPresetFromSource(e.data.preset);
    } catch (error) {
      console.error('Failed to load preset from NFT:', error);
      alert('Failed to load preset from NFT');
    }
  }
});

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {

  // --- Get references to all UI elements ---
  const synthContainer = document.getElementById('synth-container');
  const addSynthButton = document.getElementById('add-synth');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const savePresetTopBtn = document.getElementById('save-preset');
  const loadPresetTopBtn = document.getElementById('load-preset');
  const mintNfpresetBtn = document.getElementById('mint-nfpreset-btn');

  // Get modal elements
  const saveModal = document.getElementById('save-preset-modal');
  const loadModal = document.getElementById('load-preset-modal');
  const modalPresetButtons = document.getElementById('modal-preset-buttons');
  const saveModalClose = document.getElementById('save-modal-close');
  const loadModalClose = document.getElementById('load-modal-close');
  const saveNewPresetBtn = document.getElementById('save-new-preset-btn');
  const presetFileInput = document.getElementById('preset-file-input');
  const toggleAggrBtn = document.getElementById('toggle-aggr-btn');

  // New API buttons
  const algorandingBtn = document.getElementById('algoranding-btn');
  const nodelyBtn = document.getElementById('nodely-btn');
  const userNodeBtn = document.getElementById('user-node-btn');

  const apiTokenModal = document.getElementById('api-token-modal');
  const tokenModalClose = document.getElementById('token-modal-close');
  const apiTokenInput = document.getElementById('api-token-input');
  const saveApiTokenBtn = document.getElementById('save-api-token-btn');

  // NFT loading elements
  const loadAssetIdInput = document.getElementById('load-asset-id-input');
  const loadAssetIdBtn = document.getElementById('load-asset-id-btn');
  const refreshNftPresetsBtn = document.getElementById('refresh-nft-presets-btn');
  const userNftPresetsContainer = document.getElementById('user-nft-presets-container');
  const loadErrorDisplay = document.getElementById('load-error-display');
  const loadErrorText = document.getElementById('load-error-text');

  // Mint NFPreset click handler
  mintNfpresetBtn.addEventListener('click', async () => {
      const nftName = document.getElementById('nfpreset-nft-name').value.trim();
      const unitName = document.getElementById('nfpreset-unit-name').value.trim();
      const supply = parseInt(document.getElementById('nfpreset-supply').value) || 1;
      const ipfsToken = document.getElementById('nfpreset-ipfs-token').value.trim();
      const imageInput = document.getElementById('nfpreset-image-input');

      if (!nftName) {
          alert('Please enter an NFT name');
          return;
      }
      if (!unitName) {
          alert('Please enter a unit name');
          return;
      }
      if (!ipfsToken) {
          alert('Please enter your Pinata JWT token');
          return;
      }

      // Get the preset data
      const presetData = {
          activeSynths: activeSynths.filter(instance => instance.id !== 'master').map(instance => ({
              id: instance.id,
              config: instance.config,
              settings: instance.settings
          })),
      };
      const jsonString = JSON.stringify(presetData);
      const compressed = btoa(unescape(encodeURIComponent(jsonString)));

      // Get the image file if selected
      let imageFile = null;
      if (imageInput && imageInput.files && imageInput.files[0]) {
          imageFile = imageInput.files[0];
      }

      window.parent.postMessage({
          type: 'MINT_NFPRESET',
          preset: compressed,
          nftName,
          unitName,
          supply,
          ipfsToken,
          imageFile: imageFile
      }, '*');
  });

  // <<< ADDED MISSING FUNCTION DEFINITION HERE >>>
  function populateLoadModal() {
      const container = document.getElementById('modal-preset-buttons');
      container.innerHTML = ''; // Clear previous buttons

      // Add buttons for server presets
      ['presets/max-pain.json', 'presets/vanilla.json', 'presets/block-anxiety.json'].forEach(name => {
        const button = document.createElement('button');
        button.textContent = name.replace(/^presets\//, '').replace('.json', '');
        button.dataset.fileName = name;
        container.appendChild(button);
      });

      // Add buttons for user presets from localStorage
      const userPresets = JSON.parse(localStorage.getItem('txSynthPresets') || '{}');
      const presetNames = Object.keys(userPresets);
      if (presetNames.length > 0) {
          presetNames.forEach(name => {
              const button = document.createElement('button');
              button.textContent = name;
              button.dataset.presetName = name;
              container.appendChild(button);
          });
      }
  }

//  await initAudio();

  // Start empty, then add Master
  activeSynths = [];
  synthContainer.innerHTML = '';

  // Create and add the master synth
  const masterSynthHTML = createMasterSynthHTML();
  synthContainer.innerHTML += masterSynthHTML;

  // Add a placeholder for the master synth in the active synths array
  // This allows it to be found/excluded by other functions without needing full settings.
  activeSynths.push({
      id: 'master',
      config: {},
      settings: getDefaultInstanceSettings(), // Give master proper settings
      toneObjects: null // Master FX chain will be handled separately
  });

  addSynthButton.addEventListener('click', async () => {
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

    await initializeToneForInstance(newInstance);
    renderParameterArea(newInstance.id, null, null);
  });

  // Attach main control listeners
  startBtn.addEventListener('click', () => {
    startTransactionStream();
  });
  stopBtn.addEventListener('click', () => {
    stopTransactionStream();
  });

  // --- MODAL LISTENERS ---
  loadPresetTopBtn.addEventListener('click', () => {
      populateLoadModal();
      loadModal.style.display = 'block';
      // Auto-load user's NFT presets when modal opens
      if (refreshNftPresetsBtn) {
        refreshNftPresetsBtn.click();
      }
  });
  savePresetTopBtn.addEventListener('click', () => {
      saveModal.style.display = 'block';
  });

  // Close modals
  loadModalClose.addEventListener('click', () => { loadModal.style.display = 'none'; });
  saveModalClose.addEventListener('click', () => { saveModal.style.display = 'none'; });
  window.addEventListener('click', (event) => {
      if (event.target == loadModal) loadModal.style.display = 'none';
      if (event.target == saveModal) saveModal.style.display = 'none';
  });

  // Listener for buttons inside the load modal
  modalPresetButtons.addEventListener('click', (event) => {
      const target = event.target;
      if (target.tagName !== 'BUTTON') return;

      if (target.dataset.fileName) { // For server presets
          loadPresetFromSource(target.dataset.fileName);
          loadModal.style.display = 'none'; // Close modal after loading
      } else if (target.dataset.presetName) { // For user presets from localStorage
          loadPresetFromLocalStorage(target.dataset.presetName);
          loadModal.style.display = 'none';
      }
  });

  saveNewPresetBtn.addEventListener('click', savePresetLayout);

  presetFileInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
          loadPresetFromSource(file);
      }
      event.target.value = null;
  });

  initializeEventListeners();

  updateStatus('Ready');
  initializeTypeCounts();
  injectSliderStyles();
  loadPersistentCounters();

  // <<< Event listeners for new toggle buttons >>>
  toggleAggrBtn.addEventListener('click', () => {
      const currentState = toggleAggrBtn.textContent;
      if (currentState === 'Aggr Txs') {
          toggleAggrBtn.textContent = 'Single Txs';
      } else {
          toggleAggrBtn.textContent = 'Aggr Txs';
      }
      // Functionality to be added later
  });

  // New API button event listeners
  algorandingBtn.addEventListener('click', () => {
    setMempoolMode('algoranding');
  });

  nodelyBtn.addEventListener('click', () => {
    setMempoolMode('nodely');
  });

  userNodeBtn.addEventListener('click', () => {
    handleUserNodeSelection();
  });

  // Update token modal listeners
  tokenModalClose.addEventListener('click', () => {
      apiTokenModal.style.display = 'none';
  });

  saveApiTokenBtn.addEventListener('click', () => {
      const userToken = apiTokenInput.value.trim();
      if (userToken) {
          localStorage.setItem('userAlgodToken', userToken);

          // Switch to user node mode for mempool, nodely for blocks
          currentMempoolMode = 'user_node';
          currentBlockMode = 'nodely'; // Changed from 'user_node' to 'nodely'
          AlgorandAPI.setMempoolMode('user_node');
          AlgorandAPI.setBlockMode('nodely');
          AlgorandAPI.setApiToken(userToken);

          apiTokenModal.style.display = 'none';
          updateApiButtonStates();
          console.log("User API token saved and applied. Using Your Node for mempool, Nodely for blocks.");

          // Restart stream if currently playing
          if (isPlaying) {
            stopTransactionStream();
            setTimeout(() => startTransactionStream(), 1000);
          }
      } else {
          alert("Please enter a valid API token.");
      }
  });

  // Initialize API modes and button states
  initializeApiModes();
  updateApiButtonStates();

  // Initialize state proof countdown
  await initializeStateProofCountdown();

  // Load by Asset ID functionality
  loadAssetIdBtn?.addEventListener('click', async () => {
    const assetId = loadAssetIdInput?.value.trim();
    if (!assetId) {
      showLoadError('Please enter an Asset ID');
      return;
    }

    const assetIdNum = parseInt(assetId);
    if (isNaN(assetIdNum)) {
      showLoadError('Please enter a valid Asset ID (number)');
      return;
    }

    try {
      hideLoadError();
      loadAssetIdBtn.textContent = 'Loading...';
      loadAssetIdBtn.disabled = true;

      // Request preset from React
      window.parent.postMessage({
        type: 'REQUEST_NFPRESET_LOAD',
        assetId: assetIdNum
      }, '*');

    } catch (error) {
      console.error('Failed to load preset by Asset ID:', error);
      showLoadError(`Failed to load preset: ${error.message}`);
    } finally {
      loadAssetIdBtn.textContent = 'Load';
      loadAssetIdBtn.disabled = false;
    }
  });

  // Refresh user's NFT presets
  refreshNftPresetsBtn?.addEventListener('click', async () => {
    try {
      refreshNftPresetsBtn.textContent = 'Refreshing...';
      refreshNftPresetsBtn.disabled = true;

      // Request user's preset NFTs from React
      window.parent.postMessage({
        type: 'REQUEST_NFPRESET_LIST'
      }, '*');

    } catch (error) {
      console.error('Failed to refresh NFT presets:', error);
      showLoadError('Failed to refresh your preset NFTs');
    } finally {
      refreshNftPresetsBtn.textContent = 'Refresh';
      refreshNftPresetsBtn.disabled = false;
    }
  });

  // Load user NFT preset when clicked
  function handleUserNftPresetClick(assetId) {
    try {
      // Request preset from React
      window.parent.postMessage({
        type: 'REQUEST_NFPRESET_LOAD',
        assetId: parseInt(assetId)
      }, '*');
    } catch (error) {
      console.error('Failed to load user NFT preset:', error);
      showLoadError(`Failed to load preset: ${error.message}`);
    }
  }

  // Make function globally accessible for inline onclick
  window.handleUserNftPresetClick = handleUserNftPresetClick;

  // Function to load image from IPFS
  async function loadIpfsImage(ipfsHash) {
    if (!ipfsHash) return '/nfplaceholder.png';

    try {
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
      if (response.ok) {
        return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
      }
    } catch (error) {
      console.warn(`Failed to fetch from IPFS:`, error);
    }

    return '/nfplaceholder.png';
  }

  // Display user's NFT presets as thumbnails
  async function displayUserNftPresets(presets) {
    if (!userNftPresetsContainer) return;

    if (!presets || presets.length === 0) {
      userNftPresetsContainer.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
          <p>No preset NFTs found in your wallet</p>
          <p style="font-size: 12px; margin-top: 4px;">Mint some presets first to see them here</p>
        </div>
      `;
      return;
    }

    // Show loading spinner while processing
    userNftPresetsContainer.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <style>
            .spinner_jCIR{animation:spinner_B8Vq .9s linear infinite;animation-delay:-.9s}
            .spinner_upm8{animation-delay:-.8s}
            .spinner_2eL5{animation-delay:-.7s}
            .spinner_Rp9l{animation-delay:-.6s}
            .spinner_dy3W{animation-delay:-.5s}
            @keyframes spinner_B8Vq{0%,66.66%{animation-timing-function:cubic-bezier(0.36,.61,.3,.98);y:6px;height:12px}33.33%{animation-timing-function:cubic-bezier(0.36,.61,.3,.98);y:1px;height:22px}}
          </style>
          <rect class="spinner_jCIR" x="1" y="6" width="2.8" height="12"/>
          <rect class="spinner_jCIR spinner_upm8" x="5.8" y="6" width="2.8" height="12"/>
          <rect class="spinner_jCIR spinner_2eL5" x="10.6" y="6" width="2.8" height="12"/>
          <rect class="spinner_jCIR spinner_Rp9l" x="15.4" y="6" width="2.8" height="12"/>
          <rect class="spinner_jCIR spinner_dy3W" x="20.2" y="6" width="2.8" height="12"/>
        </svg>
        <p style="margin-top: 10px; color: #666; font-size: 12px;">Loading...</p>
      </div>
    `;

    // Process presets to get thumbnail URLs
    const presetsWithThumbnails = await Promise.all(presets.map(async (preset) => {
      let thumbnailUrl = '/nfplaceholder.png';

      // Debug: log the preset URL to see what's being processed
      console.log(`Processing preset ${preset.id}:`, preset.url);

      // Extract IPFS hash from preset URL
      if (preset.url && preset.url !== 'ipfs://QmPlaceholder#arc3') {
        const ipfsMatch = preset.url.match(/ipfs:\/\/([^#]+)/);
        if (ipfsMatch) {
          const metadataHash = ipfsMatch[1];

          // Check if this looks like a valid IPFS hash (should be 46+ characters for CIDv0)
          if (metadataHash.length < 10 || metadataHash === 'QmPlaceholder') {
            console.warn(`Skipping invalid IPFS hash for preset ${preset.id}: ${metadataHash}`);
          } else {
            try {
              console.log(`Fetching metadata from IPFS: ${metadataHash}`);
              // Fetch metadata to get image URL
              const metadataResponse = await fetch(`https://gateway.pinata.cloud/ipfs/${metadataHash}`);
              if (metadataResponse.ok) {
                const metadata = await metadataResponse.json();
                console.log(`Metadata for preset ${preset.id}:`, metadata);
                if (metadata.image) {
                  const imageMatch = metadata.image.match(/ipfs:\/\/([^#]+)/);
                  if (imageMatch) {
                    const imageHash = imageMatch[1];
                    console.log(`Loading image for preset ${preset.id}: ${imageHash}`);
                    thumbnailUrl = await loadIpfsImage(imageHash);
                  }
                }
              } else {
                console.warn(`Failed to fetch metadata for preset ${preset.id}: ${metadataResponse.status}`);
              }
            } catch (error) {
              console.warn(`Error fetching metadata for preset ${preset.id}:`, error);
            }
          }
        }
      } else if (preset.url === 'ipfs://QmPlaceholder#arc3') {
        console.log(`Preset ${preset.id} has placeholder URL, skipping IPFS fetch`);
      }

      return { ...preset, thumbnailUrl };
    }));

    const presetsHtml = presetsWithThumbnails.map(preset => `
      <div
        class="nft-preset-item"
        style="border: 1px solid #ddd; border-radius: 4px; padding: 4px; margin-bottom: 8px; background: transparent; display: inline-block; width: 96px; height: 120px; margin-right: 8px; vertical-align: top; overflow: hidden;"
      >
        <div style="text-align: center; height: 100%;">
          <img
            src="${preset.thumbnailUrl}"
            alt="${preset.name || `Asset ${preset.id}`}"
            style="width: 88px; height: 88px; object-fit: contain; border-radius: 2px; cursor: pointer; display: block; margin: 0 auto 2px auto;"
            onclick="handleUserNftPresetClick(${preset.id})"
            onerror="this.src='/nfplaceholder.png'"
          />
          <h4 style="font-weight: 500; margin: 0 0 1px 0; font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.1;">${preset.name || `Asset ${preset.id}`}</h4>
          <p style="font-size: 8px; color: #666; margin: 0 0 1px 0;">
            ID: ${preset.id}
          </p>
          <p style="font-size: 7px; color: #999; margin: 0;">
            Synths: ${preset.preset?.activeSynths?.length || 0}
          </p>
        </div>
      </div>
    `).join('');

    userNftPresetsContainer.innerHTML = presetsHtml;
  }

  // Error handling functions
  function showLoadError(message) {
    if (loadErrorText) {
      loadErrorText.textContent = message;
    }
    if (loadErrorDisplay) {
      loadErrorDisplay.style.display = 'block';
    }
  }

  function hideLoadError() {
    if (loadErrorDisplay) {
      loadErrorDisplay.style.display = 'none';
    }
  }

  // Make error functions globally accessible
  window.showLoadError = showLoadError;
  window.hideLoadError = hideLoadError;
  window.loadNftPreset = loadNftPreset;

  // Listen for messages from React
  window.addEventListener('message', (event) => {
    if (event.data.type === 'NFPRESET_LIST') {
      displayUserNftPresets(event.data.presets);
    } else if (event.data.type === 'NFPRESET_LOAD_RESULT') {
      if (event.data.success) {
        // Load the preset into the synth using the new function
        loadNftPreset(event.data.preset);
      } else {
        showLoadError('Failed to load preset from NFT');
      }
    }
  });
});

// <<< initializeEventListeners Uses Event Delegation >>>
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

    // <<< Handle Master controls separately >>>
    if (instanceId === 'master') {
        switch(controlIdentifier) {
            case 'volume':
                const masterVol = parseFloat(target.value);
                Tone.Destination.volume.rampTo(masterVol, 0.02);
                document.getElementById(`${instanceId}-volume-value`).textContent = `${masterVol.toFixed(1)} dB`;
                break;
            case 'comp-thresh':
                const compThresh = parseFloat(target.value);
                if (masterCompressor) masterCompressor.threshold.value = compThresh;
                document.getElementById(`${instanceId}-comp-thresh-val`).textContent = `${compThresh.toFixed(0)} dB`;
                break;
            case 'comp-ratio':
                const compRatio = parseFloat(target.value);
                if (masterCompressor) masterCompressor.ratio.value = compRatio;
                document.getElementById(`${instanceId}-comp-ratio-val`).textContent = `${compRatio.toFixed(0)}:1`;
                break;
            case 'eq-low':
                const eqLow = parseFloat(target.value);
                if (masterEQ) masterEQ.low.value = eqLow;
                document.getElementById(`${instanceId}-eq-low-val`).textContent = `${eqLow.toFixed(0)} dB`;
                break;
            case 'eq-mid':
                const eqMid = parseFloat(target.value);
                if (masterEQ) masterEQ.mid.value = eqMid;
                document.getElementById(`${instanceId}-eq-mid-val`).textContent = `${eqMid.toFixed(0)} dB`;
                break;
            case 'eq-high':
                const eqHigh = parseFloat(target.value);
                if (masterEQ) masterEQ.high.value = eqHigh;
                document.getElementById(`${instanceId}-eq-high-val`).textContent = `${eqHigh.toFixed(0)} dB`;
                break;
            case 'limit-thresh':
                const limitThresh = parseFloat(target.value);
                if (masterLimiter) masterLimiter.threshold.value = limitThresh;
                document.getElementById(`${instanceId}-limit-thresh-val`).textContent = `${limitThresh.toFixed(1)} dB`;
                break;
        }
        return; // Stop further processing for master controls
    }

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
        case 'reverb-size':
             handleReverbSizeChangeLogic(instanceId, target.value, target);
             break;
        case 'reverb-wet': // Changed from 'wet'
             handleReverbWetChangeLogic(instanceId, target.value, target);
             break;

        // <<< LFO Controls >>>
        case 'lfo-rate':
            handleLfoRateChangeLogic(instanceId, target.value, target);
            break;
        case 'lfo-depth':
            handleLfoDepthChangeLogic(instanceId, target.value, target);
            break;
        default:
             // console.log("Unhandled range input:", target.id, controlIdentifier);
             break;
    }
};

// --- Logic Functions (Separated from direct event handling) ---

function findInstance(instanceId) {
    const instance = activeSynths.find(s => s.id === instanceId);
    if (!instance && instanceId !== 'master') {
        console.warn(`Could not find synth instance ${instanceId}`);
    }
    return instance;
}

const handleMuteLogic = (instanceId, buttonElement) => {
    // <<< Master Mute Logic using synthesis module >>>
    if (instanceId === 'master') {
        // Use synthesis module for master mute functionality
        const newMuteState = toggleMasterMute(activeSynths);
        buttonElement.innerHTML = newMuteState ? svgIconMuted : svgIconUnmuted;

        // Update UI buttons for all synths based on their current state
        updateAllSynthMuteButtons();

        return;
    }

    // <<< Individual synth mute logic >>>
    const instance = findInstance(instanceId);
    if (!instance) return;

    // Handle different scenarios based on current state
    if (isMasterMuted && instance.settings.mutedByMaster) {
        // Case: Master is muted, and this synth was muted by master
        // Action: Unmute this synth (override master mute for this synth)
        instance.settings.mutedByMaster = false;
        unmuteSynthVolume(instance);
        console.log(`Instance ${instanceId} unmuted (override master mute)`);
    } else if (isMasterMuted && !instance.settings.mutedByMaster && !instance.settings.muted) {
        // Case: Master is muted, but this synth was manually unmuted
        // Action: Re-mute this synth by master
        instance.settings.mutedByMaster = true;
        muteSynthVolume(instance);
        console.log(`Instance ${instanceId} re-muted by master`);
    } else {
        // Case: Normal user mute/unmute (master not engaged or synth has individual mute)
        instance.settings.muted = !instance.settings.muted;
        console.log(`Instance ${instanceId} user mute toggled to: ${instance.settings.muted}`);

        // Update Tone object for user mute/unmute
        if (!instance.settings.muted && !instance.settings.mutedByMaster && instance.toneObjects?.synth?.volume) {
            instance.toneObjects.synth.volume.rampTo(instance.settings.volume, 0.02); // Short ramp
        }
    }

    // Update button icon based on current state
    updateSynthMuteButton(instanceId, instance);
};

const handleCloseLogic = (instanceId, synthElement) => {
    const index = activeSynths.findIndex(s => s.id === instanceId);
    if (index > -1) {
        console.log(`Removing synth instance ${instanceId}`);

        // Handle UI-specific cleanup first
        stopStateProofCountdown(instanceId);
        // Then dispose synthesis objects
        disposeSynth(instanceId, activeSynths);
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

    // CRITICAL FIX: Special case for stpf - auto-set subtype
    if (selectedType === 'stpf') {
        instance.config.subtype = 'stpf';
    }

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
    renderParameterArea(instanceId, selectedType, instance.config.subtype); // Pass correct subtype
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
    // Back-compat: map old decay (in seconds) to Freeverb roomSize (0-1)
    const instance = findInstance(instanceId);
    if (!instance) return;
    const decaySeconds = parseFloat(valueStr);
    const roomSize = Math.max(0, Math.min(1, decaySeconds / 10));
    instance.settings.reverb.roomSize = roomSize;
    const display = document.getElementById(`${instanceId}-reverb-size-value`);
    if (display) display.textContent = roomSize.toFixed(2);
    if (instance.toneObjects?.reverb?.roomSize?.rampTo) {
        instance.toneObjects.reverb.roomSize.rampTo(roomSize, 0.02);
    } else if (instance.toneObjects?.reverb) {
        instance.toneObjects.reverb.roomSize = roomSize;
    }
};

const handleReverbSizeChangeLogic = (instanceId, valueStr, inputElement) => {
    const instance = findInstance(instanceId);
    if (!instance) return;
    const value = Math.max(0, Math.min(1, parseFloat(valueStr)));
    instance.settings.reverb.roomSize = value;
    const display = document.getElementById(`${instanceId}-reverb-size-value`);
    if (display) display.textContent = value.toFixed(2);
    if (instance.toneObjects?.reverb?.roomSize?.rampTo) {
        instance.toneObjects.reverb.roomSize.rampTo(value, 0.02);
    } else if (instance.toneObjects?.reverb) {
        instance.toneObjects.reverb.roomSize = value;
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

    // <<< Update LFO if targeting pitch >>>
    if (instance.settings.lfo.destination === 'pitch') {
        connectLFO(instance);
    }
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

            // <<< Update LFO if targeting pitch >>>
            if (instance.settings.lfo.destination === 'pitch') {
                connectLFO(instance);
            }
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

// <<< renderParameterArea handles keyreg toggle better AND adds Label >>>
function renderParameterArea(instanceId, type, subtype) {
    const paramArea = document.getElementById(`params-${instanceId}`);
    if (!paramArea) return;
    paramArea.innerHTML = ''; // Clear existing
    const instance = findInstance(instanceId); // Needed for current values
    if (!instance) return;

    let paramHTML = ''; // Start with empty HTML

    // <<< UPDATED: Special handling for stpf type >>>
    if (type === 'stpf') {
        // CRITICAL FIX: Set the subtype so transaction matching works
        instance.config.subtype = 'stpf';

        // Initialize countdown display (will be populated when synth is created)
        paramHTML += `<span id="${instanceId}-stpf-countdown" class="countdown-value">...</span>`;

        paramArea.innerHTML = paramHTML;

        // Initialize the countdown asynchronously
        initializeStateProofCountdown(instanceId);
        return;
    }

    // Special handling for block type - show current round
    if (type === 'block') {
        paramHTML += `<span id="${instanceId}-current-round" class="current-round-value">${currentRound > 0 ? currentRound : 'N/A'}</span>`;
        paramArea.innerHTML = paramHTML;
        return;
    }

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

// Corrected injectSliderStyles function
const injectSliderStyles = () => {
    // This function is kept for potential future use,
    // but the main styles for .seq-input are now in index.html
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

// <<< LFO Logic Functions >>>

// scaleLfoDepth function moved to tone-synthesis.js

// connectLFO function moved to tone-synthesis.js

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

// <<< Functions to manage persistent counters >>>
function loadPersistentCounters() {
    persistentTotalTxs = parseInt(localStorage.getItem('persistentTotalTxs') || '0', 10);
    persistentTotalBlocks = parseInt(localStorage.getItem('persistentTotalBlocks') || '0', 10);
    updatePersistentCountersDisplay();
}

function updatePersistentCountersDisplay() {
    const persistentTxEl = document.getElementById('persistent-tx-count');
    const persistentBlockEl = document.getElementById('persistent-block-count');
    if (persistentTxEl) {
        persistentTxEl.textContent = `Lifetime Txs: ${persistentTotalTxs.toLocaleString()}`;
    }
    if (persistentBlockEl) {
        persistentBlockEl.textContent = `Lifetime Blocks: ${persistentTotalBlocks.toLocaleString()}`;
    }
}

// <<< Now loads a named preset from Local Storage directly >>>
const loadPresetFromLocalStorage = async (presetNameToLoad) => {
  const presetName = presetNameToLoad;
  if (!presetName) return;

  let loadedData = null;
  let isOldFormat = false;

  const userPresets = JSON.parse(localStorage.getItem('txSynthPresets') || 'null');
  if (userPresets && userPresets[presetName]) {
      loadedData = userPresets[presetName];
      isOldFormat = loadedData.settings && !loadedData.activeSynths;
  }

  if (!loadedData) {
    alert(`Preset '${presetName}' not found in Local Storage.`);
    return;
  }

  console.log(`Loading preset: ${presetName} (from local storage)`);

  // --- Clear Current State more surgically ---
  console.log("Clearing current synths and UI...");
  const regularSynths = activeSynths.filter(s => s.id !== 'master');
  regularSynths.forEach(instance => {
      // Handle UI-specific cleanup first
      stopStateProofCountdown(instance.id);
      // Then dispose synthesis objects
      disposeSynth(instance.id, activeSynths);
  });
  activeSynths = activeSynths.filter(s => s.id === 'master');

  const synthContainer = document.getElementById('synth-container');
  const regularSynthElements = synthContainer.querySelectorAll('.mini-synth:not(.master-synth)');
  regularSynthElements.forEach(el => el.remove());

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
  activeSynths.push(...targetActiveSynths);
  console.log("Applied loaded/migrated settings. Active Synths:", activeSynths);

  console.log("Rebuilding UI...");
  targetActiveSynths.forEach(instance => {
      synthContainer.innerHTML += createSynthHTML(instance);
      // Render parameter area based on loaded config
      renderParameterArea(instance.id, instance.config.type, instance.config.subtype);
  });

  // --- Initialize Audio for New Instances ---
  console.log("Initializing audio objects for loaded synths...");
  // Ensure global context is running first
  if (!synthsInitialized) { await initAudio(); }
  // Initialize Tone for each loaded instance
  for (const instance of targetActiveSynths) {
      await initializeToneForInstance(instance);
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

// <<< Helper functions for master mute management >>>
function getAllRegularSynths() {
    return activeSynths.filter(instance => instance.id !== 'master');
}

// Helper function to determine if a synth should be visually muted
function shouldSynthBeVisuallyMuted(instance) {
    // A synth should show as muted if:
    // 1. It's muted by the user, OR
    // 2. It's muted by master mute (and master mute is active)
    return instance.settings.muted || (instance.settings.mutedByMaster && isMasterMuted);
}

function updateSynthMuteButton(instanceId, instance) {
    const buttonElement = document.querySelector(`.mute-btn[data-instance-id="${instanceId}"]`);
    if (buttonElement && instance) {
        const shouldBeMuted = shouldSynthBeVisuallyMuted(instance);
        buttonElement.innerHTML = shouldBeMuted ? svgIconMuted : svgIconUnmuted;
    }
}

// Update all synth mute buttons based on current state
function updateAllSynthMuteButtons() {
    getAllRegularSynths().forEach(instance => {
        updateSynthMuteButton(instance.id, instance);
    });
}

// muteSynthVolume and unmuteSynthVolume functions moved to tone-synthesis.js

// Make functions available globally for HTML onclick handlers
window.startTransactionStream = startTransactionStream;
window.stopTransactionStream = stopTransactionStream;
// Add other functions that HTML buttons call

// Add these new functions
function initializeApiModes() {
  const storedToken = localStorage.getItem('userAlgodToken');

  if (storedToken) {
    // User has a token, use user node for both mempool and blocks
    currentMempoolMode = 'user_node';
    currentBlockMode = 'user_node';
    AlgorandAPI.setMempoolMode('user_node');
    AlgorandAPI.setBlockMode('user_node');
    AlgorandAPI.setApiToken(storedToken);
    console.log("Using stored token for Your Node (mempool and blocks)");
  } else {
    // No token, use algoranding for mempool, nodely for blocks
    currentMempoolMode = 'algoranding';
    currentBlockMode = 'nodely';
    AlgorandAPI.setMempoolMode('algoranding');
    AlgorandAPI.setBlockMode('nodely');
    console.log("Using Algoranding for mempool, Nodely for blocks");
  }
}

function setMempoolMode(mode) {
  if (mode === 'algoranding') {
    currentMempoolMode = 'algoranding';
    currentBlockMode = 'nodely';
    AlgorandAPI.setMempoolMode('algoranding');
    AlgorandAPI.setBlockMode('nodely');
    console.log("Using Algoranding for mempool, Nodely for blocks");
  } else if (mode === 'nodely') {
    // Nodely is disabled - this shouldn't be called
    console.warn("Nodely mode is disabled");
    return;
  }

  updateApiButtonStates();

  // Restart stream if currently playing
  if (isPlaying) {
    stopTransactionStream();
    setTimeout(() => startTransactionStream(), 1000);
  }
}

function handleUserNodeSelection() {
  const storedToken = localStorage.getItem('userAlgodToken');

  if (storedToken) {
    // User has a token, switch to user node for mempool, but keep algoranding for blocks
    currentMempoolMode = 'user_node';
    currentBlockMode = 'user_node'; // Use user_node for blocks too when token available
    AlgorandAPI.setMempoolMode('user_node');
    AlgorandAPI.setBlockMode('user_node');
    AlgorandAPI.setApiToken(storedToken);
    updateApiButtonStates();
    console.log("Using Your Node for mempool and blocks");
  } else {
    // No token, show the modal
    const apiTokenModal = document.getElementById('api-token-modal');
    if (apiTokenModal) {
      apiTokenModal.style.display = 'block';
    }
  }
}

function updateApiButtonStates() {
  const algorandingBtn = document.getElementById('algoranding-btn');
  const nodelyBtn = document.getElementById('nodely-btn');
  const userNodeBtn = document.getElementById('user-node-btn');

  if (!algorandingBtn || !nodelyBtn || !userNodeBtn) {
    console.error("API buttons not found in DOM");
    return;
  }

  // Remove active class from all buttons
  [algorandingBtn, nodelyBtn, userNodeBtn].forEach(btn => {
    btn.classList.remove('active');
  });

  // Add active class to current mode
  if (currentMempoolMode === 'algoranding') {
    algorandingBtn.classList.add('active');
  } else if (currentMempoolMode === 'nodely') {
    nodelyBtn.classList.add('active');
  } else if (currentMempoolMode === 'user_node') {
    userNodeBtn.classList.add('active');
  }

  console.log(`Updated button states: mempool=${currentMempoolMode}, block=${currentBlockMode}`);
}

// Load NFT preset data directly
function loadNftPreset(presetData) {
  try {
    console.log('Loading NFT preset data:', presetData);

    if (!presetData.activeSynths || !Array.isArray(presetData.activeSynths)) {
      throw new Error('NFT preset is missing "activeSynths" array.');
    }

    console.log(`Loading NFT preset with ${presetData.activeSynths.length} synths`);

    // Clear Current State - more surgically
    const regularSynths = activeSynths.filter(s => s.id !== 'master');
    regularSynths.forEach(instance => {
        // Handle UI-specific cleanup first
        stopStateProofCountdown(instance.id);
        // Then dispose synthesis objects
        disposeSynth(instance.id, activeSynths);
    });
    activeSynths = activeSynths.filter(s => s.id === 'master');

    const synthContainer = document.getElementById('synth-container');
    const regularSynthElements = synthContainer.querySelectorAll('.mini-synth:not(.master-synth)');
    regularSynthElements.forEach(el => el.remove());

    // Process Loaded Data
    let targetActiveSynths = presetData.activeSynths.map(loadedInstance => ({
      ...loadedInstance,
      settings: {
        ...getDefaultInstanceSettings(),
        ...(loadedInstance.settings || {})
      },
      toneObjects: null
    }));

    // Update State and Rebuild UI
    activeSynths.push(...targetActiveSynths);

    targetActiveSynths.forEach(instance => {
      synthContainer.innerHTML += createSynthHTML(instance);
      renderParameterArea(instance.id, instance.config.type, instance.config.subtype);
    });

    // Initialize Audio for New Instances
    if (!synthsInitialized) {
      initAudio().then(() => {
        targetActiveSynths.forEach(instance => {
          initializeToneForInstance(instance);
        });
      });
    } else {
      targetActiveSynths.forEach(instance => {
        initializeToneForInstance(instance);
      });
    }

    updateStatus(`NFT preset loaded successfully`);
    // Find the modal element directly
    const loadModal = document.getElementById('load-preset-modal');
    if (loadModal) {
      loadModal.style.display = 'none';
    }
    hideLoadError();

  } catch (error) {
    console.error('Failed to load NFT preset:', error);
    showLoadError(`Error loading NFT preset: ${error.message}`);
  }
}

// Listen for messages from React
