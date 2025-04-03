// At the top of proto-synth.js
import AlgorandAPI from './algorand-direct.js';

// Tone.js synth setup
let synthsInitialized = false;
let isPlaying = false;
let transactionCount = 0;
let txTypeCounts = {}; // Object to hold counts for each type

// Synths object - holds Tone.js instances
let synths = {}; // Changed to let

// Define the chromatic scale for cycling
const chromaticScale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const defaultOctave = 4;

// Synth settings (Defaults, will be populated/overwritten by loading)
let synthSettings = { // Changed to let
  pay: { /* ... default settings ... */ baseNote: 'G4', volume: -30 },
  axfer: { /* ... default settings ... */ baseNote: 'C4', volume: -30 },
  appl: { /* ... default settings ... */ baseNote: 'A4', volume: -30 },
  acfg: { /* ... default settings ... */ baseNote: 'A4', noteDuration: 0.5, volume: -30 },
  keyreg: { /* ... default settings ... */ baseNote: 'A4', noteDuration: 0.5, volume: -30 },
  afrz: { /* ... default settings ... */ baseNote: 'A4', noteDuration: 0.5, volume: -30 },
  stpf: { /* ... default settings ... */ baseNote: 'A4', noteDuration: 0.5, volume: -30 },
  hb: { /* ... default settings ... */ baseNote: 'A4', noteDuration: 0.5, volume: -30 }
};
// Ensure all defaults have envelope, oscillator, delay, reverb, pitch, muted, baseNote, noteDuration

// Helper to ensure full default settings structure
function ensureDefaultSettings(settings) {
    const types = ['pay', 'axfer', 'appl', 'acfg', 'keyreg', 'afrz', 'stpf', 'hb'];
    types.forEach(type => {
        if (!settings[type]) settings[type] = {};
        settings[type].oscillator = settings[type].oscillator || { type: 'sine' };
        settings[type].envelope = settings[type].envelope || { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 };
        settings[type].volume = settings[type].volume ?? -30;
        settings[type].muted = settings[type].muted || false;
        settings[type].pitch = settings[type].pitch || 0;
        settings[type].delay = settings[type].delay || { time: 0, feedback: 0, wet: 0 };
        settings[type].reverb = settings[type].reverb || { decay: 1.5, wet: 0.3 };
        settings[type].noteDuration = settings[type].noteDuration || (['pay', 'axfer', 'appl'].includes(type) ? 0.1 : 0.5);
        settings[type].baseNote = settings[type].baseNote || `A${defaultOctave}`;
    });
    return settings;
}
synthSettings = ensureDefaultSettings(synthSettings); // Apply defaults initially


// Transaction types
const txTypes = Object.keys(synthSettings);

// --- Helper to initialize or reset type counts ---
function initializeTypeCounts() {
    txTypeCounts = {}; // Reset
    Object.keys(synthSettings).forEach(type => {
        txTypeCounts[type] = 0; // Initialize all known types to 0
    });
    // Also update display initially
    updateTypeCountsDisplay(); 
}

// Create HTML for a single synth
const createSynthHTML = (type) => {
  // Ensure settings exist for the type before trying to read them
  if (!synthSettings[type]) {
      console.warn(`Settings for type "${type}" not found, applying defaults.`);
      synthSettings = ensureDefaultSettings(synthSettings); // Ensure defaults exist
  }
  const currentSettings = synthSettings[type]; // Use the guaranteed settings
  const currentVolume = currentSettings.volume ?? -30; // Changed fallback to -30 dB

  const htmlString = `
    <div class="mini-synth" data-type="${type}">
      <div class="synth-header">
        <div class="led" id="led-${type}"></div>
        <div>${type}</div>
        <button class="mute-btn">${currentSettings.muted ? '🔈' : '🔇'}</button>
        <button class="close-btn">X</button>
      </div>
      
      <!-- Volume Section -->
      <div class="volume-section"> 
        <div class="control-row">
          <span class="control-label">Volume: <span id="${type}-volume-value">${currentVolume.toFixed(1)} dB</span></span>
        </div>
        <div class="control-row">
          <input type="range" id="${type}-volume" min="-60" max="6" step="0.5" value="${currentVolume}">
        </div>
      </div>
      
      <!-- Base Note Section -->
      <div class="base-note-section">
        <span class="control-label">Base Note</span>
        <div class="control-row base-note-controls">
            <button class="base-note-down" data-type="${type}">←</button>
            <span class="base-note-display" id="${type}-base-note-display">${currentSettings.baseNote}</span>
            <button class="base-note-up" data-type="${type}">→</button>
        </div>
      </div>

      <!-- Gate Time Section -->
      <div class="gate-section"> 
      <div class="control-row">
          <span class="control-label">Gate Time: <span id="${type}-note-duration-value">${currentSettings.noteDuration.toFixed(2)}s</span></span>
      </div>
      <div class="control-row">
          <input type="range" id="${type}-note-duration" min="0.01" max="0.5" step="0.01" value="${currentSettings.noteDuration}">
        </div>
      </div>
      
      <!-- ADSR Section -->
      <div class="adsr-section"> 
        <div class="control-row"> 
          <span class="control-label">Attack</span> <span class="control-label">Decay</span>
        </div>
        <div class="control-row">
          <input type="range" id="${type}-attack" min="0" max="1" step="0.01" value="${currentSettings.envelope.attack}">
          <input type="range" id="${type}-decay" min="0" max="1" step="0.01" value="${currentSettings.envelope.decay}">
        </div>
      <div class="control-row">
          <span class="control-label">Sustain</span> <span class="control-label">Release</span>
      </div>
      <div class="control-row">
          <input type="range" id="${type}-sustain" min="0" max="1" step="0.01" value="${currentSettings.envelope.sustain}">
          <input type="range" id="${type}-release" min="0" max="2" step="0.01" value="${currentSettings.envelope.release}">
        </div>
      </div>
      
      <div class="waveform-section">
        <span class="control-label">Waveform</span>
        <select id="${type}-waveform" class="waveform-select">
          <option value="sine" ${currentSettings.oscillator.type === 'sine' ? 'selected' : ''}>Sine</option>
          <option value="square" ${currentSettings.oscillator.type === 'square' ? 'selected' : ''}>Square</option>
          <option value="triangle" ${currentSettings.oscillator.type === 'triangle' ? 'selected' : ''}>Triangle</option>
          <option value="sawtooth" ${currentSettings.oscillator.type === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
        </select>
      </div>
      
      <div class="effect-controls">
        <div class="control-row"> <span class="control-label">Pitch: <span id="${type}-pitch-value">${currentSettings.pitch}</span></span> </div>
        <div class="control-row"> <input type="range" id="${type}-pitch" min="-12" max="12" step="1" value="${currentSettings.pitch}"> </div>
        <div class="control-row"> <span class="control-label">Delay Time: <span id="${type}-delay-time-value">${currentSettings.delay.time.toFixed(2)}s</span></span> </div>
        <div class="control-row"> <input type="range" id="${type}-delay-time" min="0" max="1" step="0.01" value="${currentSettings.delay.time}"> </div>
        <div class="control-row"> <span class="control-label">Feedback: <span id="${type}-delay-feedback-value">${currentSettings.delay.feedback.toFixed(2)}</span></span> </div>
        <div class="control-row"> <input type="range" id="${type}-delay-feedback" min="0" max="0.9" step="0.01" value="${currentSettings.delay.feedback}"> </div>
        <div class="control-row"> <span class="control-label">Delay Wet: <span id="${type}-delay-wet-value">${currentSettings.delay.wet.toFixed(2)}</span></span> </div>
        <div class="control-row"> <input type="range" id="${type}-delay-wet" min="0" max="1" step="0.01" value="${currentSettings.delay.wet}"> </div>
        </div>
        
      <div class="reverb-section"> 
        <div class="control-row"> <span class="control-label">Reverb Decay: <span id="${type}-reverb-decay-value">${currentSettings.reverb.decay.toFixed(2)}s</span></span> </div>
        <div class="control-row"> <input type="range" id="${type}-reverb-decay" min="0.1" max="10" step="0.1" value="${currentSettings.reverb.decay}"> </div>
        <div class="control-row"> <span class="control-label">Reverb Wet: <span id="${type}-reverb-wet-value">${currentSettings.reverb.wet.toFixed(2)}</span></span> </div>
        <div class="control-row"> <input type="range" id="${type}-reverb-wet" min="0" max="1" step="0.01" value="${currentSettings.reverb.wet}"> </div>
      </div>
    </div>
  `;
  return htmlString;
};


// Initialize audio context and synths
const initAudio = async () => {
  // Only run initialization if not already done or if synths object is empty
  if (synthsInitialized && Object.keys(synths).length > 0) return;
  
  console.log('Attempting Audio Initialization...');
  await Tone.start();
  console.log('Audio context started');
  
  // Determine which synth types are currently needed based on the UI
  const synthContainer = document.getElementById('synth-container');
  const typesInUI = new Set([...synthContainer.querySelectorAll('.mini-synth')].map(el => el.dataset.type));

  // Dispose of synths not currently in the UI
  for (const type in synths) {
      if (!typesInUI.has(type)) {
          disposeSynth(type);
      }
  }

  // Initialize synths for types present in the UI
  for (const type of typesInUI) {
      if (!synths[type]) { 
          try {
              // Ensure settings exist
              if (!synthSettings[type]) synthSettings = ensureDefaultSettings(synthSettings);

              // Create delay effect
    const delay = new Tone.FeedbackDelay({
      delayTime: synthSettings[type].delay.time,
      feedback: synthSettings[type].delay.feedback,
      wet: synthSettings[type].delay.wet
    });
    
              // Create Reverb for EACH synth
              const reverb = new Tone.Reverb({
                  decay: synthSettings[type].reverb.decay,
                  wet: synthSettings[type].reverb.wet
              }).toDestination();

              await reverb.generate();

              // Create Synth and apply initial settings INCLUDING VOLUME
              const synth = new Tone.Synth({
                  ...synthSettings[type], // Spread existing settings
                  volume: synthSettings[type].volume ?? -30 // Changed default to -30 dB
              });

              // Connect Synth -> Delay -> Reverb -> Output
              synth.connect(delay);
    delay.connect(reverb);
    
              // Store instances
              synths[type] = { synth, delay, reverb }; // Store all parts

          } catch (error) {
              console.error(`Failed to create audio objects for ${type}:`, error);
          }
      }
  }
  
  synthsInitialized = true;
  updateStatus('Audio initialized');
};

// Helper function to dispose Tone.js objects for a synth type
function disposeSynth(type) {
    if (synths[type]) {
        console.log(`Disposing synth objects for type: ${type}`);
        if (synths[type].synth && synths[type].synth.dispose) synths[type].synth.dispose();
        if (synths[type].delay && synths[type].delay.dispose) synths[type].delay.dispose();
        if (synths[type].reverb && synths[type].reverb.dispose) synths[type].reverb.dispose();
        delete synths[type];
    }
}

// Replace the entire startTransactionStream function with this version
const startTransactionStream = async () => {
  if (!synthsInitialized || Object.keys(synths).length === 0) {
      console.log("Synths not initialized or none exist, attempting init...");
      await initAudio();
      if (!synthsInitialized || Object.keys(synths).length === 0) {
          alert('Audio could not be initialized or no synths are present.');
    return;
      }
  }
  
  // Reset counters when starting stream
  transactionCount = 0;
  initializeTypeCounts(); // Reset per-type counts too
  
  isPlaying = true;
  updateStatus('Connecting to Algorand node...');
  
  console.log("Attempting to connect to Algorand node...");
  const connected = await AlgorandAPI.initAlgodConnection();
  
  console.log("Algorand node connection attempt result:", connected);
  
  if (connected) {
    console.log("Connected to Algorand node - using real transaction data");
    updateStatus('Connected to Algorand node - streaming transactions');
    
    AlgorandAPI.startPolling((txType, txData, index) => {
      if (!isPlaying) return;
      const synthType = txType.split('-')[0]; 
      
      // --- Update Counts ---
      transactionCount++;
      const totalCountEl = document.getElementById('transaction-count');
      if (totalCountEl) totalCountEl.textContent = `${transactionCount} transactions processed`;
      if (txTypeCounts.hasOwnProperty(synthType)) {
          txTypeCounts[synthType]++;
      } else {
          console.warn(`Received unexpected transaction type: ${synthType}`);
          txTypeCounts[synthType] = 1; 
      }
      updateTypeCountsDisplay(); 
      // --- End Count Update ---

      // Play sound (check synth exists and is not muted)
      if (synths[synthType] && synths[synthType].synth && synthSettings[synthType] && !synthSettings[synthType].muted) { 
        playTransactionSound(synthType, index);
      }
      
    }, 50); 
  } else {
    console.error("Couldn't connect to Algorand node");
    updateStatus('Failed to connect to Algorand node');
    isPlaying = false;
    alert('Could not connect to the Algorand node. Please check your node configuration and try again.');
  }
};

// Update stopTransactionStream to:
const stopTransactionStream = () => {
  isPlaying = false;
  AlgorandAPI.stopPolling();
  updateStatus('Stream stopped');
};

// Play a sound for a specific transaction type
const playTransactionSound = (type, index = 0) => {
  // Ensure synth and its core parts exist
  if (!synths[type] || !synths[type].synth || !synthSettings[type]) {
    // console.warn(`Synth or settings for type "${type}" not ready for playback.`);
    return; 
  }

  // console.log(`Playing sound for transaction type: ${type}`); // Keep if helpful
  
  const baseNote = synthSettings[type].baseNote || `A${defaultOctave}`;
  const pitchShift = synthSettings[type].pitch || 0;
  const note = Tone.Frequency(baseNote).transpose(pitchShift);
  
  // --- INCREASED TIME OFFSET ---
  const timeOffset = index * 0.010; // Changed from 0.005 to 0.010 (10ms)
  
  const duration = synthSettings[type].noteDuration || 0.1;
  
  // console.log(`Note: ${note} (base: ${baseNote}, shift: ${pitchShift}) at +${timeOffset.toFixed(3)}s`); // Optional debug
  
  try {
    // Trigger the synth - use the synth instance stored in the synths object
    synths[type].synth.triggerAttackRelease(note, duration, Tone.now() + timeOffset, 0.7 + (Math.random() * 0.3));
  } catch (error) {
      // Log the scheduling error but allow processing to continue
      console.error(`Tone.js scheduling error for ${type} at offset ${timeOffset.toFixed(3)}s:`, error.message);
  }
  
  // Flash the LED (also with delay to match sound)
  setTimeout(() => {
    flashLED(type);
  }, timeOffset * 1000); // Convert to ms for setTimeout
};

// Flash the LED for a transaction type
const flashLED = (type) => {
  const led = document.getElementById(`led-${type}`);
  if (!led) return;
  
  led.classList.add('active');
  setTimeout(() => {
    led.classList.remove('active');
  }, 100);
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
    
    if (synthSettings[type] && synthSettings[type].oscillator) {
      synthSettings[type].oscillator.type = waveform;
      
      // Update synth if initialized
      if (synths[type]) {
        synths[type].synth.oscillator.type = waveform;
      }
    }
  });
});

// Handle pitch control changes
document.querySelectorAll('input[id$="-pitch"]').forEach(input => {
  input.addEventListener('input', (e) => {
    const type = e.target.id.split('-')[0];
    const value = parseInt(e.target.value);
    
    synthSettings[type].pitch = value;
    document.getElementById(`${type}-pitch-value`).textContent = value.toString();
  });
});

// Handle note duration changes
document.querySelectorAll('input[id$="-note-duration"]').forEach(input => {
  input.addEventListener('input', (e) => {
    const type = e.target.id.split('-')[0];
    const value = parseFloat(e.target.value);
    
    synthSettings[type].noteDuration = value;
    document.getElementById(`${type}-note-duration-value`).textContent = `${value.toFixed(2)}s`;
  });
});

// Update savePreset function to include waveform and pitch settings
const savePreset = () => {
  const presetName = document.getElementById('preset-name').value.trim();
  if (!presetName) {
    // Keep this alert, as it's important feedback for invalid input
    alert('Please enter a preset name');
    return;
  }
  
  const preset = {
    displayedSynths: [],
    settings: {}
  };

  // Get displayed synth types IN ORDER
  const synthElements = document.querySelectorAll('#synth-container .mini-synth');
  preset.displayedSynths = [...synthElements].map(el => el.dataset.type);

  // Get unique types to save settings for
  const uniqueTypes = [...new Set(preset.displayedSynths)];

  // Save settings for each unique type based on current global synthSettings
  uniqueTypes.forEach(type => {
      if (synthSettings[type]) {
          // Deep copy the settings object to avoid reference issues
          preset.settings[type] = JSON.parse(JSON.stringify(synthSettings[type]));
      } else {
          console.warn(`Settings for type ${type} not found during save.`);
      }
  });

  const presets = JSON.parse(localStorage.getItem('txSynthPresets') || '{}');
  presets[presetName] = preset;
  localStorage.setItem('txSynthPresets', JSON.stringify(presets));
  
  updatePresetList(); // Update dropdown

  // Optional: Provide non-blocking feedback instead
  console.log(`Preset "${presetName}" saved`); 
  // Or update a status message element briefly
  // updateStatus(`Preset "${presetName}" saved`); 
  // setTimeout(() => updateStatus('Streaming...'), 2000); // Clear after 2s
};

// Update loadPreset function to handle waveform and pitch settings
const loadPreset = async () => { 
  const presetName = document.getElementById('preset-list').value;
  if (!presetName) {
    return; 
  }
  
  const presets = JSON.parse(localStorage.getItem('txSynthPresets') || '{}');
  const loadedPresetData = presets[presetName];
  
  if (!loadedPresetData) {
    // Keep this alert for feedback on failure
    alert('Preset not found');
    return;
  }
  
  if (!loadedPresetData.displayedSynths || !loadedPresetData.settings) {
      // Keep this alert for feedback on failure
      alert('Preset data is in an old or invalid format. Cannot load.');
      return;
  }

  console.log(`Loading preset: ${presetName}`);

  // --- 1. Clear Current State ---
  console.log("Disposing existing synths...");
  Object.keys(synths).forEach(type => disposeSynth(type)); // Use helper
  synths = {}; // Reset synths object
  synthsInitialized = false; // Mark audio as needing re-initialization

  const synthContainer = document.getElementById('synth-container');
  synthContainer.innerHTML = ''; // Clear UI

  // --- 2. Apply Loaded Settings to Global synthSettings ---
  synthSettings = {}; // Clear existing global settings
  for (const type in loadedPresetData.settings) {
      // Apply loaded settings, ensuring defaults for any missing keys
      synthSettings[type] = ensureDefaultSettings({ [type]: loadedPresetData.settings[type] })[type];
  }
  console.log("Applied loaded settings:", synthSettings);


  // --- 3. Rebuild UI based on loaded displayedSynths ---
  console.log("Rebuilding UI for:", loadedPresetData.displayedSynths);
  loadedPresetData.displayedSynths.forEach(type => {
      // Need to ensure settings for this type were actually loaded
      if (synthSettings[type]) {
          synthContainer.innerHTML += createSynthHTML(type);
      } else {
          console.warn(`Preset listed type "${type}" but settings were missing. Skipping UI creation.`);
      }
  });


  // --- 4. Re-initialize Audio based on NEW state ---
  console.log("Re-initializing audio...");
  await initAudio(); // Create Tone objects for the loaded synths

  // --- 5. Re-initialize Listeners & Update UI Values/Displays ---
  console.log("Re-initializing listeners and updating displays...");
  initializeEventListeners(); // Attach listeners to the NEWLY created elements
  
  // Optional: Provide non-blocking feedback instead
  console.log(`Preset "${presetName}" loaded successfully.`);
  // Or update a status message element briefly
  // updateStatus(`Preset "${presetName}" loaded`);
  // setTimeout(() => updateStatus('Streaming...'), 2000); // Clear after 2s
};

// Update the preset dropdown list
const updatePresetList = () => {
  const presetList = document.getElementById('preset-list');
  presetList.innerHTML = '<option value="">Select a preset</option>';
  
  const presets = JSON.parse(localStorage.getItem('txSynthPresets') || '{}');
  
  for (const name in presets) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    presetList.appendChild(option);
  }
};

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
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

  // Create initial synths (based on initial default synthSettings keys)
  Object.keys(synthSettings).forEach(type => {
      synthContainer.innerHTML += createSynthHTML(type);
  });
  
  // Add Synth Button
  addSynthButton.addEventListener('click', () => {
    const type = prompt('Enter transaction type (pay, axfer, appl, acfg, keyreg, afrz, stpf, hb):');
    const lowerType = type?.toLowerCase(); // Handle null from cancel
    if (lowerType && txTypes.includes(lowerType)) {
        // Ensure default settings exist before creating HTML
        if (!synthSettings[lowerType]) synthSettings = ensureDefaultSettings(synthSettings);
        synthContainer.innerHTML += createSynthHTML(lowerType); 
        // Initialize the audio for the *new* synth if needed (or rely on next Start click)
        // For simplicity, let's assume initAudio() will handle it on Start or preset load
        initializeEventListeners(); // Re-attach ALL listeners
    } else if (type !== null) { 
      alert('Invalid transaction type');
    }
  });
  
  // Attach other listeners
  startBtn.addEventListener('click', startTransactionStream); 
  stopBtn.addEventListener('click', stopTransactionStream);
  savePresetNameBtn.addEventListener('click', savePreset);
  presetListSelect.addEventListener('change', loadPreset); // Load on dropdown change

  initializeEventListeners(); // Initial listener setup for default synths
  updatePresetList();
  updateStatus('Ready');

  // --- Initialize and Display Counts ---
  initializeTypeCounts(); // Set all counts to 0 and update display
});

// Initialize all event listeners for controls
const initializeEventListeners = () => {
  // Handle mute buttons
  document.querySelectorAll('.mute-btn').forEach(button => {
    button.removeEventListener('click', handleMuteClick);
    button.addEventListener('click', handleMuteClick);
  });
  
  // Handle close buttons
  document.querySelectorAll('.close-btn').forEach(button => {
    button.removeEventListener('click', handleCloseClick);
    button.addEventListener('click', handleCloseClick);
  });
  
  // Handle ADSR control changes
  document.querySelectorAll('input[id$="-attack"], input[id$="-decay"], input[id$="-sustain"], input[id$="-release"]').forEach(input => {
    input.removeEventListener('input', handleEnvelopeChange);
    input.addEventListener('input', handleEnvelopeChange);
  });
  
  // Handle waveform selection
  document.querySelectorAll('.waveform-select').forEach(select => {
    select.removeEventListener('change', handleWaveformChange);
    select.addEventListener('change', handleWaveformChange);
  });
  
  // Handle pitch control changes
  document.querySelectorAll('input[id$="-pitch"]').forEach(input => {
    input.removeEventListener('input', handlePitchChange);
    input.addEventListener('input', handlePitchChange);
  });
  
  // Handle note duration changes
  document.querySelectorAll('input[id$="-note-duration"]').forEach(input => {
    input.removeEventListener('input', handleNoteDurationChange);
    input.addEventListener('input', handleNoteDurationChange);
  });
  
  // Handle delay time changes
  document.querySelectorAll('input[id$="-delay-time"]').forEach(input => {
    input.removeEventListener('input', handleDelayTimeChange);
    input.addEventListener('input', handleDelayTimeChange);
  });
  
  // Handle delay feedback changes
  document.querySelectorAll('input[id$="-delay-feedback"]').forEach(input => {
    input.removeEventListener('input', handleDelayFeedbackChange);
    input.addEventListener('input', handleDelayFeedbackChange);
  });
  
  // Handle delay wet changes
  document.querySelectorAll('input[id$="-delay-wet"]').forEach(input => {
    input.removeEventListener('input', handleDelayWetChange); 
    input.addEventListener('input', handleDelayWetChange);
  });
  
  // Handle reverb decay changes
  document.querySelectorAll('input[id$="-reverb-decay"]').forEach(input => {
    input.removeEventListener('input', handleReverbDecayChange);
    input.addEventListener('input', handleReverbDecayChange);
  });

  // Handle reverb wet changes
  document.querySelectorAll('input[id$="-reverb-wet"]').forEach(input => {
    input.removeEventListener('input', handleReverbWetChange);
    input.addEventListener('input', handleReverbWetChange);
  });
  
  // Handle Base Note Down buttons
  document.querySelectorAll('.base-note-down').forEach(button => {
    button.removeEventListener('click', handleBaseNoteDownClick);
    button.addEventListener('click', handleBaseNoteDownClick);
  });
  
  // Handle Base Note Up buttons
  document.querySelectorAll('.base-note-up').forEach(button => {
    button.removeEventListener('click', handleBaseNoteUpClick);
    button.addEventListener('click', handleBaseNoteUpClick);
  });
  
  // Handle Volume sliders
  document.querySelectorAll('input[id$="-volume"]').forEach(input => {
    input.removeEventListener('input', handleVolumeChange); 
    input.addEventListener('input', handleVolumeChange);
  });
  
  updateAllValueDisplays();
};

// Handler functions
const handleMuteClick = (e) => {
  const type = e.target.closest('.mini-synth').dataset.type;
  synthSettings[type].muted = !synthSettings[type].muted;
  e.target.textContent = synthSettings[type].muted ? '🔈' : '🔇';
};

const handleCloseClick = (e) => {
  // Remove the synth from the UI
  const synthElement = e.target.closest('.mini-synth');
  if (!synthElement) return;
  const type = synthElement.dataset.type;
  disposeSynth(type); // Use helper
  delete synthSettings[type]; // Remove from settings tracking
  synthElement.remove();
};

const handleEnvelopeChange = (e) => {
  const [type, param] = e.target.id.split('-');
  const value = parseFloat(e.target.value);
  
  if (synthSettings[type] && synthSettings[type].envelope) {
    synthSettings[type].envelope[param] = value;
    
    // Update synth if initialized
    if (synths[type]) {
      synths[type].synth.envelope[param] = value;
    }
  }
};

const handleWaveformChange = (e) => {
  const type = e.target.id.split('-')[0];
  const waveform = e.target.value;
  
  if (synthSettings[type] && synthSettings[type].oscillator) {
    synthSettings[type].oscillator.type = waveform;
    
    // Update synth if initialized
    if (synths[type]) {
      synths[type].synth.oscillator.type = waveform;
    }
  }
};

const handlePitchChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseInt(e.target.value);
  
  synthSettings[type].pitch = value;
  document.getElementById(`${type}-pitch-value`).textContent = value.toString();
};

const handleNoteDurationChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value);
  
  synthSettings[type].noteDuration = value;
  document.getElementById(`${type}-note-duration-value`).textContent = `${value.toFixed(2)}s`;
};

const handleDelayTimeChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value);
  
  if (synthSettings[type]?.delay) {
  synthSettings[type].delay.time = value;
      const valueEl = document.getElementById(`${type}-delay-time-value`);
      if (valueEl) valueEl.textContent = `${value.toFixed(2)}s`;
      if (synths[type]?.delay) {
        synths[type].delay.delayTime.value = value; // Update the actual Tone.js object
      }
  }
};

const handleDelayFeedbackChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value);
  
  synthSettings[type].delay.feedback = value;
  document.getElementById(`${type}-delay-feedback-value`).textContent = value.toFixed(2);
  
  if (synths[type] && synths[type].delay) {
    synths[type].delay.feedback.value = value;
  }
};

const handleDelayWetChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value);

  // Update settings object
  if (!synthSettings[type].delay) synthSettings[type].delay = {}; // Ensure object exists
  synthSettings[type].delay.wet = value;

  // Update display
  const valueEl = document.getElementById(`${type}-delay-wet-value`);
  if (valueEl) valueEl.textContent = value.toFixed(2);

  // Update actual synth instance if initialized
  if (synths[type] && synths[type].delay) {
    synths[type].delay.wet.value = value; // wet is a Signal, use .value
  }
};

const handleReverbDecayChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value);

  synthSettings[type].reverb.decay = value;
  document.getElementById(`${type}-reverb-decay-value`).textContent = value.toFixed(2);

  if (synths[type] && synths[type].reverb) {
    synths[type].reverb.decay = value;
  }
};

const handleReverbWetChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value);
  
  synthSettings[type].reverb.wet = value;
  document.getElementById(`${type}-reverb-wet-value`).textContent = value.toFixed(2);

  if (synths[type] && synths[type].reverb) {
    synths[type].reverb.wet = value;
  }
};

// Base Note Handlers
const handleBaseNoteDownClick = (e) => {
    const type = e.target.dataset.type;
    changeBaseNote(type, -1);
};

const handleBaseNoteUpClick = (e) => {
    const type = e.target.dataset.type;
    changeBaseNote(type, 1);
};

// Helper function to change the base note
const changeBaseNote = (type, direction) => {
    if (!synthSettings[type] || !synthSettings[type].baseNote) return;

    const currentNoteWithOctave = synthSettings[type].baseNote;
    let noteName = '';
    let octave = defaultOctave;

    // Attempt to parse Note + Octave
    const match = currentNoteWithOctave.match(/^([A-G]#?)([0-9])$/);
    if (match) {
        noteName = match[1];
        octave = parseInt(match[2], 10);
    } else {
        // Fallback if only note name (less ideal)
        noteName = currentNoteWithOctave;
        console.warn(`Could not parse octave from baseNote: ${currentNoteWithOctave}. Using default octave ${defaultOctave}.`);
    }

    let currentIndex = chromaticScale.indexOf(noteName);
    if (currentIndex === -1) {
        console.error(`Could not find note name "${noteName}" in chromatic scale.`);
        return; 
    }

    let newIndex = (currentIndex + direction + chromaticScale.length) % chromaticScale.length;
    const newNoteName = chromaticScale[newIndex];
    const newBaseNote = `${newNoteName}${octave}`;

    // Update the central synthSettings object
    synthSettings[type].baseNote = newBaseNote;

    // Update the display in the UI
    const displayEl = document.getElementById(`${type}-base-note-display`);
    if (displayEl) {
        displayEl.textContent = newBaseNote;
    }
};

// Update All Value Displays - Modify to read from synthSettings
const updateAllValueDisplays = () => {
  document.querySelectorAll('.mini-synth').forEach(synthEl => {
      const type = synthEl.dataset.type;
      if (!type || !synthSettings[type]) return; 

      // Volume
      const volumeInput = document.getElementById(`${type}-volume`);
      const volumeValueEl = document.getElementById(`${type}-volume-value`);
      if (volumeInput && volumeValueEl) volumeValueEl.textContent = `${parseFloat(volumeInput.value).toFixed(1)} dB`;
      
      // ... (updates for base note, gate, ADSR, waveform, pitch, delay, reverb) ...
  });
};

// Function to Update Type Counts Display
function updateTypeCountsDisplay() {
    const container = document.getElementById('type-counts-container');
    if (!container) return;

    // --- CHANGE: Use synthSettings keys for order ---
    // Get the types in the order they are defined in synthSettings
    const orderedTypes = Object.keys(synthSettings); 

    // Get all types that actually have received counts
    const typesWithCounts = Object.keys(txTypeCounts);

    let htmlContent = '';

    // First, display types known in synthSettings, in their defined order
    orderedTypes.forEach(type => {
        const count = txTypeCounts[type] || 0; // Get count, default to 0 if not seen yet
        htmlContent += `<span class="type-count" id="count-${type}">${type}: ${count}</span> `;
    });

    // Second, display any unexpected types seen from the API at the end
    typesWithCounts.forEach(type => {
        // If this type wasn't in our original synthSettings order, add it now
        if (!orderedTypes.includes(type)) { 
            const count = txTypeCounts[type]; // Should always have a count > 0 here
            console.log(`Displaying unexpected type: ${type}`); // Optional log
             htmlContent += `<span class="type-count unexpected-type" id="count-${type}">${type}: ${count}</span> `; // Added a class for potential styling
        }
    });
    // --- END CHANGE ---

    container.innerHTML = htmlContent;
}

// Add this new handler function
const handleVolumeChange = (e) => {
  const type = e.target.id.split('-')[0];
  const value = parseFloat(e.target.value); // Value is in dB

  if (synthSettings[type]) {
      // Update settings object
      synthSettings[type].volume = value;

      // Update display
      const valueEl = document.getElementById(`${type}-volume-value`);
      if (valueEl) valueEl.textContent = `${value.toFixed(1)} dB`;

      // Update actual synth instance if initialized
      // Ensure synth instance exists and has the synth part
      if (synths[type] && synths[type].synth && synths[type].synth.volume) { 
          synths[type].synth.volume.value = value; // volume is a Signal, use .value
      }
  }
};
