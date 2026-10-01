/**
 * Devtober 2026 - Day 01: PULSE
 * Audio Synthesizer (Hertz Generator), Custom Track Player & Tweaker, and Pulse Visualizer
 */

(function () {
  'use strict';

  // State Management
  const state = {
    audioContext: null,
    isMasterPlaying: false,
    masterVolume: 0.8,
    isMuted: false,

    // Synth (Hertz Generator)
    synth: {
      isPlaying: false,
      frequency: 432,
      waveform: 'sine', // sine, square, sawtooth, triangle, whitenoise, pinknoise
      pulseMode: 'heartbeat', // off, heartbeat, rhythmic, sine, binaural
      pulseRate: 1.2, // Hz (approx 72 BPM)
      pulseDepth: 0.7,
      gain: 0.5,
      nodes: {
        osc: null,
        oscR: null, // For binaural
        noise: null,
        gain: null,
        pulseLfo: null,
        pulseLfoGain: null,
        panL: null,
        panR: null
      }
    },

    // Custom Track Tweaker
    track: {
      buffer: null,
      sourceNode: null,
      isPlaying: false,
      startTime: 0,
      pauseOffset: 0,
      duration: 0,
      fileName: '',
      isLooping: true,
      playbackRate: 1.0,
      volume: 0.85,
      filterType: 'lowpass',
      filterFreq: 20000,
      filterQ: 1.0,
      distortion: 0,
      delayTime: 0,
      delayFeedback: 0.35,
      nodes: {
        gain: null,
        filter: null,
        waveshaper: null,
        delay: null,
        delayFeedbackGain: null,
        panner: null
      }
    },

    // Visualizer Mode
    visMode: 'hybrid', // hybrid, pulse, osc, spectrum
    dockVisible: true
  };

  // Cached Noise Buffers
  let whiteNoiseBuffer = null;
  let pinkNoiseBuffer = null;

  // DOM Elements
  const els = {
    canvas: document.getElementById('visualizer-canvas'),
    overviewCanvas: document.getElementById('waveform-overview-canvas'),
    timelineProgress: document.getElementById('timeline-progress'),
    timelineBox: document.getElementById('timeline-box'),
    masterPlayBtn: document.getElementById('btn-master-play'),
    masterMuteBtn: document.getElementById('btn-master-mute'),
    masterVolSlider: document.getElementById('master-volume'),
    masterMeterFill: document.getElementById('master-meter-fill'),
    controlDock: document.getElementById('control-dock'),
    btnToggleDock: document.getElementById('btn-toggle-dock'),
    
    // Synth controls
    freqInput: document.getElementById('freq-number-input'),
    freqSlider: document.getElementById('freq-slider'),
    freqBandTag: document.getElementById('freq-band-tag'),
    synthGainSlider: document.getElementById('synth-gain'),
    synthGainVal: document.getElementById('synth-gain-val'),
    synthPulseMode: document.getElementById('synth-pulse-mode'),
    synthPulseRate: document.getElementById('synth-pulse-rate'),
    synthPulseRateVal: document.getElementById('synth-pulse-rate-val'),
    synthPulseDepth: document.getElementById('synth-pulse-depth'),
    synthPulseDepthVal: document.getElementById('synth-pulse-depth-val'),
    btnSynthToggle: document.getElementById('btn-synth-toggle'),
    
    // Track controls
    dropzone: document.getElementById('track-dropzone'),
    fileInput: document.getElementById('audio-file-input'),
    btnDemoTrack: document.getElementById('btn-load-demo'),
    trackCard: document.getElementById('track-info-card'),
    trackTitle: document.getElementById('track-title'),
    trackTime: document.getElementById('track-time'),
    btnTrackPlay: document.getElementById('btn-track-play'),
    btnTrackStop: document.getElementById('btn-track-stop'),
    btnTrackLoop: document.getElementById('btn-track-loop'),
    trackRateSlider: document.getElementById('track-rate'),
    trackRateVal: document.getElementById('track-rate-val'),
    filterFreqSlider: document.getElementById('filter-freq'),
    filterFreqVal: document.getElementById('filter-freq-val'),
    filterQSlider: document.getElementById('filter-q'),
    filterQVal: document.getElementById('filter-q-val'),
    trackDistSlider: document.getElementById('track-dist'),
    trackDistVal: document.getElementById('track-dist-val'),
    trackDelaySlider: document.getElementById('track-delay'),
    trackDelayVal: document.getElementById('track-delay-val'),
    trackDelayFbSlider: document.getElementById('track-delay-fb'),
    trackDelayFbVal: document.getElementById('track-delay-fb-val'),
    trackVolSlider: document.getElementById('track-volume'),
    trackVolVal: document.getElementById('track-volume-val'),

    // Stats HUD
    statHz: document.getElementById('stat-hz'),
    statBpm: document.getElementById('stat-bpm'),
    statDb: document.getElementById('stat-db')
  };

  // Canvas contexts
  const ctx2d = els.canvas.getContext('2d');
  const overviewCtx = els.overviewCanvas ? els.overviewCanvas.getContext('2d') : null;

  // Analyser and master gain
  let masterGainNode = null;
  let analyserNode = null;
  let timeData = null;
  let freqData = null;

  // Initialize Web Audio Context
  function initAudio() {
    if (state.audioContext) {
      if (state.audioContext.state === 'suspended') {
        state.audioContext.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();

    // Master Gain
    masterGainNode = state.audioContext.createGain();
    masterGainNode.gain.setValueAtTime(state.masterVolume, state.audioContext.currentTime);

    // Analyser Node
    analyserNode = state.audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.82;

    masterGainNode.connect(analyserNode);
    analyserNode.connect(state.audioContext.destination);

    timeData = new Uint8Array(analyserNode.frequencyBinCount);
    freqData = new Uint8Array(analyserNode.frequencyBinCount);

    // Prepare Track FX chain nodes
    setupTrackChain();

    // Generate White & Pink Noise Buffers
    createNoiseBuffers();
  }

  // Set up the audio processing rack for custom track
  function setupTrackChain() {
    const actx = state.audioContext;
    const t = state.track.nodes;

    t.gain = actx.createGain();
    t.gain.gain.setValueAtTime(state.track.volume, actx.currentTime);

    t.filter = actx.createBiquadFilter();
    t.filter.type = state.track.filterType;
    t.filter.frequency.setValueAtTime(state.track.filterFreq, actx.currentTime);
    t.filter.Q.setValueAtTime(state.track.filterQ, actx.currentTime);

    t.waveshaper = actx.createWaveShaper();
    t.waveshaper.curve = makeDistortionCurve(state.track.distortion);
    t.waveshaper.oversample = '4x';

    t.delay = actx.createDelay(2.0);
    t.delay.delayTime.setValueAtTime(state.track.delayTime, actx.currentTime);

    t.delayFeedbackGain = actx.createGain();
    t.delayFeedbackGain.gain.setValueAtTime(state.track.delayFeedback, actx.currentTime);

    // Wire delay loop
    t.delay.connect(t.delayFeedbackGain);
    t.delayFeedbackGain.connect(t.delay);

    // Main Track Route:
    // Source -> Filter -> WaveShaper -> Gain -> (Dry to Master) & (Wet to Delay -> Master)
    t.filter.connect(t.waveshaper);
    t.waveshaper.connect(t.gain);

    t.gain.connect(masterGainNode); // Dry
    t.gain.connect(t.delay);        // Wet branch
    t.delay.connect(masterGainNode);
  }

  // WaveShaper distortion curve calculation
  function makeDistortionCurve(amount) {
    const k = amount * 50;
    const nSamples = 44100;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    
    if (k === 0) {
      for (let i = 0; i < nSamples; ++i) {
        const x = (i * 2) / nSamples - 1;
        curve[i] = x;
      }
      return curve;
    }

    for (let i = 0; i < nSamples; ++i) {
      const x = (i * 2) / nSamples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Noise Buffer Generators
  function createNoiseBuffers() {
    const actx = state.audioContext;
    const bufferSize = actx.sampleRate * 2; // 2 seconds looped

    // White Noise
    whiteNoiseBuffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const wData = whiteNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      wData[i] = Math.random() * 2 - 1;
    }

    // Pink Noise (Paul Kellet's filter method)
    pinkNoiseBuffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const pData = pinkNoiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }

  // --------------------------------------------------------------------------
  // SYNTH (HERTZ GENERATOR) ENGINE
  // --------------------------------------------------------------------------

  function startSynth() {
    initAudio();
    stopSynth();

    const actx = state.audioContext;
    const s = state.synth;
    const nodes = s.nodes;
    const now = actx.currentTime;

    nodes.gain = actx.createGain();
    nodes.gain.gain.setValueAtTime(0.0001, now);
    nodes.gain.gain.exponentialRampToValueAtTime(s.gain, now + 0.04);

    if (s.waveform === 'whitenoise' || s.waveform === 'pinknoise') {
      const buffer = s.waveform === 'whitenoise' ? whiteNoiseBuffer : pinkNoiseBuffer;
      nodes.noise = actx.createBufferSource();
      nodes.noise.buffer = buffer;
      nodes.noise.loop = true;

      // Bandpass filter to tune noise around target Hz
      const noiseFilter = actx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(s.frequency, now);
      noiseFilter.Q.setValueAtTime(3.0, now);

      nodes.noise.connect(noiseFilter);
      noiseFilter.connect(nodes.gain);
      nodes.noise.start(now);
    } else if (s.pulseMode === 'binaural') {
      // Binaural Beat: Left Ear f, Right Ear f + delta
      const merger = actx.createChannelMerger(2);
      
      nodes.osc = actx.createOscillator();
      nodes.osc.type = s.waveform;
      nodes.osc.frequency.setValueAtTime(s.frequency, now);

      nodes.oscR = actx.createOscillator();
      nodes.oscR.type = s.waveform;
      nodes.oscR.frequency.setValueAtTime(s.frequency + s.pulseRate, now);

      nodes.osc.connect(merger, 0, 0); // Left
      nodes.oscR.connect(merger, 0, 1); // Right

      merger.connect(nodes.gain);

      nodes.osc.start(now);
      nodes.oscR.start(now);
    } else {
      // Standard Oscillator
      nodes.osc = actx.createOscillator();
      nodes.osc.type = s.waveform;
      nodes.osc.frequency.setValueAtTime(s.frequency, now);

      nodes.osc.connect(nodes.gain);
      nodes.osc.start(now);
    }

    // Pulse Modulation Setup (Heartbeat, Rhythmic Gate, Sine Tremolo)
    if (s.pulseMode !== 'off' && s.pulseMode !== 'binaural') {
      setupPulseModulation();
    }

    nodes.gain.connect(masterGainNode);
    s.isPlaying = true;

    updateSynthUI();
  }

  function setupPulseModulation() {
    const actx = state.audioContext;
    const s = state.synth;
    const nodes = s.nodes;
    const now = actx.currentTime;

    if (!nodes.gain) return;

    if (s.pulseMode === 'heartbeat') {
      // Heartbeat pulse: Custom LFO modulation creating a lub-dub pulse
      nodes.pulseLfo = actx.createOscillator();
      nodes.pulseLfo.type = 'sine';
      nodes.pulseLfo.frequency.setValueAtTime(s.pulseRate, now);

      nodes.pulseLfoGain = actx.createGain();
      nodes.pulseLfoGain.gain.setValueAtTime(s.pulseDepth * s.gain, now);

      nodes.pulseLfo.connect(nodes.pulseLfoGain);
      nodes.pulseLfoGain.connect(nodes.gain.gain);
      nodes.pulseLfo.start(now);
    } else if (s.pulseMode === 'rhythmic') {
      // Square Wave Pulse Chopper
      nodes.pulseLfo = actx.createOscillator();
      nodes.pulseLfo.type = 'square';
      nodes.pulseLfo.frequency.setValueAtTime(s.pulseRate, now);

      nodes.pulseLfoGain = actx.createGain();
      nodes.pulseLfoGain.gain.setValueAtTime(s.pulseDepth * s.gain * 0.8, now);

      nodes.pulseLfo.connect(nodes.pulseLfoGain);
      nodes.pulseLfoGain.connect(nodes.gain.gain);
      nodes.pulseLfo.start(now);
    } else if (s.pulseMode === 'sine') {
      // Smooth Sine Wave Tremolo
      nodes.pulseLfo = actx.createOscillator();
      nodes.pulseLfo.type = 'sine';
      nodes.pulseLfo.frequency.setValueAtTime(s.pulseRate, now);

      nodes.pulseLfoGain = actx.createGain();
      nodes.pulseLfoGain.gain.setValueAtTime(s.pulseDepth * s.gain * 0.5, now);

      nodes.pulseLfo.connect(nodes.pulseLfoGain);
      nodes.pulseLfoGain.connect(nodes.gain.gain);
      nodes.pulseLfo.start(now);
    }
  }

  function stopSynth() {
    const s = state.synth;
    const nodes = s.nodes;

    if (nodes.gain && state.audioContext) {
      try {
        const now = state.audioContext.currentTime;
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

        setTimeout(() => {
          if (nodes.osc) {
            try { nodes.osc.stop(); nodes.osc.disconnect(); } catch (e) {}
            nodes.osc = null;
          }
          if (nodes.oscR) {
            try { nodes.oscR.stop(); nodes.oscR.disconnect(); } catch (e) {}
            nodes.oscR = null;
          }
          if (nodes.noise) {
            try { nodes.noise.stop(); nodes.noise.disconnect(); } catch (e) {}
            nodes.noise = null;
          }
          if (nodes.pulseLfo) {
            try { nodes.pulseLfo.stop(); nodes.pulseLfo.disconnect(); } catch (e) {}
            nodes.pulseLfo = null;
          }
        }, 60);
      } catch (e) {}
    }

    s.isPlaying = false;
    updateSynthUI();
  }

  function setSynthFrequency(freq) {
    const clamped = Math.min(20000, Math.max(20, parseFloat(freq) || 432));
    state.synth.frequency = clamped;

    if (state.audioContext && state.synth.nodes.osc) {
      state.synth.nodes.osc.frequency.setTargetAtTime(clamped, state.audioContext.currentTime, 0.015);
      if (state.synth.nodes.oscR) {
        state.synth.nodes.oscR.frequency.setTargetAtTime(clamped + state.synth.pulseRate, state.audioContext.currentTime, 0.015);
      }
    }

    // Update Slider (Logarithmic mapping)
    // Slider is 0..1000
    const minL = Math.log(20);
    const maxL = Math.log(20000);
    const sliderVal = ((Math.log(clamped) - minL) / (maxL - minL)) * 1000;
    els.freqSlider.value = sliderVal;
    els.freqInput.value = clamped.toFixed(clamped < 100 ? 1 : 0);

    // Band Tag
    let band = 'Moyen (Médiums)';
    if (clamped < 60) band = 'Sub-Bass (Infrasons)';
    else if (clamped < 250) band = 'Basses Fréquences';
    else if (clamped < 2000) band = 'Médiums';
    else if (clamped < 6000) band = 'Hauts-Médiums (Présence)';
    else band = 'Aigus (Brillance)';
    els.freqBandTag.textContent = band;

    els.statHz.textContent = `${clamped.toFixed(0)} Hz`;
  }

  function updateSynthUI() {
    if (state.synth.isPlaying) {
      els.btnSynthToggle.classList.add('playing');
      els.btnSynthToggle.querySelector('.btn-text').textContent = 'Arrêter Synthé';
    } else {
      els.btnSynthToggle.classList.remove('playing');
      els.btnSynthToggle.querySelector('.btn-text').textContent = 'Lancer Synthé';
    }
  }

  // --------------------------------------------------------------------------
  // CUSTOM TRACK PLAYER & TWEAKER ENGINE
  // --------------------------------------------------------------------------

  function loadAudioBuffer(arrayBuffer, fileName) {
    initAudio();
    state.audioContext.decodeAudioData(
      arrayBuffer,
      (decoded) => {
        state.track.buffer = decoded;
        state.track.fileName = fileName || 'Fichier audio';
        state.track.duration = decoded.duration;
        state.track.pauseOffset = 0;

        els.trackTitle.textContent = state.track.fileName;
        els.trackTime.textContent = formatTime(state.track.duration);
        els.trackCard.classList.add('active');

        // Render waveform overview canvas
        drawWaveformOverview(decoded);

        // Auto-play the track
        playTrack();
      },
      (err) => {
        console.error('Audio decode error', err);
      }
    );
  }

  function playTrack() {
    if (!state.track.buffer) return;
    initAudio();
    stopTrack();

    const actx = state.audioContext;
    const src = actx.createBufferSource();
    src.buffer = state.track.buffer;
    src.loop = state.track.isLooping;
    src.playbackRate.setValueAtTime(state.track.playbackRate, actx.currentTime);

    // Connect to track filter chain
    src.connect(state.track.nodes.filter);

    state.track.sourceNode = src;
    state.track.startTime = actx.currentTime - state.track.pauseOffset;

    src.start(0, state.track.pauseOffset % state.track.duration);
    state.track.isPlaying = true;

    src.onended = () => {
      if (!state.track.isLooping) {
        state.track.isPlaying = false;
        state.track.pauseOffset = 0;
        updateTrackUI();
      }
    };

    updateTrackUI();
  }

  function pauseTrack() {
    if (state.track.isPlaying && state.audioContext) {
      const elapsed = (state.audioContext.currentTime - state.track.startTime) * state.track.playbackRate;
      state.track.pauseOffset = elapsed % state.track.duration;
      stopTrackNode();
      state.track.isPlaying = false;
      updateTrackUI();
    }
  }

  function stopTrack() {
    stopTrackNode();
    state.track.isPlaying = false;
    state.track.pauseOffset = 0;
    els.timelineProgress.style.width = '0%';
    updateTrackUI();
  }

  function stopTrackNode() {
    if (state.track.sourceNode) {
      try {
        state.track.sourceNode.stop();
        state.track.sourceNode.disconnect();
      } catch (e) {}
      state.track.sourceNode = null;
    }
  }

  function seekTrack(progressRatio) {
    if (!state.track.buffer) return;
    const newOffset = progressRatio * state.track.duration;
    state.track.pauseOffset = newOffset;
    if (state.track.isPlaying) {
      playTrack();
    } else {
      els.timelineProgress.style.width = `${progressRatio * 100}%`;
    }
  }

  function updateTrackUI() {
    if (state.track.isPlaying) {
      els.btnTrackPlay.classList.add('primary');
      els.btnTrackPlay.querySelector('span').textContent = 'Pause';
    } else {
      els.btnTrackPlay.classList.remove('primary');
      els.btnTrackPlay.querySelector('span').textContent = 'Lecture';
    }

    if (state.track.isLooping) {
      els.btnTrackLoop.classList.add('active-toggle');
    } else {
      els.btnTrackLoop.classList.remove('active-toggle');
    }
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Draw full waveform on the mini scrubber canvas
  function drawWaveformOverview(buffer) {
    if (!overviewCtx) return;
    const cvs = els.overviewCanvas;
    cvs.width = cvs.clientWidth * window.devicePixelRatio;
    cvs.height = cvs.clientHeight * window.devicePixelRatio;
    const w = cvs.width;
    const h = cvs.height;

    overviewCtx.clearRect(0, 0, w, h);

    const channelData = buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / w);
    const amp = h / 2;

    overviewCtx.fillStyle = '#00e5ff';

    for (let i = 0; i < w; i++) {
      let min = 1.0;
      let max = -1.0;
      const start = i * step;
      for (let j = 0; j < step; j++) {
        const datum = channelData[start + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      overviewCtx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }

  // --------------------------------------------------------------------------
  // SYNTHESIZED DEMO PULSE GROOVE (Offline Audio Buffer Generator)
  // --------------------------------------------------------------------------

  function createDemoGrooveBuffer() {
    initAudio();
    const sampleRate = state.audioContext.sampleRate;
    const duration = 6.4; // 4 bars at 150 BPM
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, sampleRate * duration, sampleRate);

    const bpm = 150;
    const beatSec = 60 / bpm;
    const sixteenth = beatSec / 4;

    // Sub Kick Pulse
    for (let bar = 0; bar < 4; bar++) {
      for (let beat = 0; beat < 4; beat++) {
        const time = bar * beatSec * 4 + beat * beatSec;
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();

        osc.frequency.setValueAtTime(140, time);
        osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

        gain.gain.setValueAtTime(1.0, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

        osc.connect(gain);
        gain.connect(offlineCtx.destination);

        osc.start(time);
        osc.stop(time + 0.35);
      }
    }

    // Hi-hat pulse rhythm
    for (let i = 0; i < 64; i++) {
      const time = i * sixteenth;
      // White noise burst
      const bufferSize = sampleRate * 0.05;
      const noiseBuffer = offlineCtx.createBuffer(1, bufferSize, sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        output[j] = Math.random() * 2 - 1;
      }

      const white = offlineCtx.createBufferSource();
      white.buffer = noiseBuffer;

      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7500;

      const gain = offlineCtx.createGain();
      const vol = (i % 4 === 2) ? 0.35 : (i % 2 === 0 ? 0.18 : 0.08);
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

      white.connect(filter);
      filter.connect(gain);
      gain.connect(offlineCtx.destination);

      white.start(time);
      white.stop(time + 0.05);
    }

    // Melodic pulse chord stabs (Synth Brass)
    const chords = [
      [220, 261.63, 329.63], // Am
      [174.61, 220, 261.63], // F
      [196, 246.94, 293.66], // G
      [164.81, 207.65, 246.94] // E
    ];

    chords.forEach((chord, barIndex) => {
      const barStart = barIndex * beatSec * 4;
      [0, 1.5, 2.5, 3.25].forEach((stabOffset) => {
        const time = barStart + stabOffset * beatSec;
        chord.forEach((note) => {
          const osc = offlineCtx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(note, time);

          const filter = offlineCtx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(3200, time);
          filter.frequency.exponentialRampToValueAtTime(450, time + 0.28);
          filter.Q.value = 4;

          const gain = offlineCtx.createGain();
          gain.gain.setValueAtTime(0.18, time);
          gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(offlineCtx.destination);

          osc.start(time);
          osc.stop(time + 0.32);
        });
      });
    });

    offlineCtx.startRendering().then((renderedBuffer) => {
      state.track.buffer = renderedBuffer;
      state.track.fileName = 'Pulse Groove 150 BPM (Synthetise)';
      state.track.duration = renderedBuffer.duration;
      state.track.pauseOffset = 0;

      els.trackTitle.textContent = state.track.fileName;
      els.trackTime.textContent = formatTime(state.track.duration);
      els.trackCard.classList.add('active');

      drawWaveformOverview(renderedBuffer);
      playTrack();
    });
  }

  // --------------------------------------------------------------------------
  // MASTER TRANSPORT & TOGGLES
  // --------------------------------------------------------------------------

  function toggleMasterPlay() {
    initAudio();
    if (state.synth.isPlaying || state.track.isPlaying) {
      // Pause everything
      if (state.synth.isPlaying) stopSynth();
      if (state.track.isPlaying) pauseTrack();
      state.isMasterPlaying = false;
      els.masterPlayBtn.classList.remove('playing');
      els.masterPlayBtn.querySelector('.btn-label').textContent = 'Activer Audio';
    } else {
      // Start active source (Synth or Track)
      if (state.track.buffer) {
        playTrack();
      } else {
        startSynth();
      }
      state.isMasterPlaying = true;
      els.masterPlayBtn.classList.add('playing');
      els.masterPlayBtn.querySelector('.btn-label').textContent = 'Audio En Cours';
    }
  }

  // --------------------------------------------------------------------------
  // REAL-TIME CANVAS PULSE VISUALIZER
  // --------------------------------------------------------------------------

  let canvasW = 0;
  let canvasH = 0;

  function resizeCanvas() {
    canvasW = els.canvas.width = window.innerWidth * window.devicePixelRatio;
    canvasH = els.canvas.height = window.innerHeight * window.devicePixelRatio;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Pulse animation state
  let animTime = 0;
  let smoothBass = 0;
  let smoothVolume = 0;

  function renderVisualizer() {
    requestAnimationFrame(renderVisualizer);
    animTime++;

    // Fade trail background
    ctx2d.fillStyle = 'rgba(8, 8, 17, 0.28)';
    ctx2d.fillRect(0, 0, canvasW, canvasH);

    let bassEnergy = 0;
    let volumeRMS = 0;

    if (analyserNode && timeData && freqData) {
      analyserNode.getByteTimeDomainData(timeData);
      analyserNode.getByteFrequencyData(freqData);

      // Compute bass energy (bins 1 to 14: ~20-300Hz)
      let bassSum = 0;
      const bassBins = Math.min(14, freqData.length);
      for (let i = 1; i <= bassBins; i++) {
        bassSum += freqData[i];
      }
      bassEnergy = bassSum / (bassBins * 255);

      // Compute overall RMS volume
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const norm = (timeData[i] - 128) / 128;
        sumSquares += norm * norm;
      }
      volumeRMS = Math.sqrt(sumSquares / timeData.length);

      // Update VU meter UI
      if (els.masterMeterFill) {
        const meterPercent = Math.min(100, Math.max(0, volumeRMS * 220));
        els.masterMeterFill.style.width = `${meterPercent}%`;
      }

      // Update HUD Stats
      if (els.statDb) {
        const db = volumeRMS > 0.001 ? (20 * Math.log10(volumeRMS)).toFixed(1) : '-inf';
        els.statDb.textContent = `${db} dB`;
      }
    }

    // Smooth physics for pulse reaction
    smoothBass += (bassEnergy - smoothBass) * 0.25;
    smoothVolume += (volumeRMS - smoothVolume) * 0.25;

    // Track timeline scrubber update
    if (state.track.isPlaying && state.audioContext && state.track.duration > 0) {
      const elapsed = (state.audioContext.currentTime - state.track.startTime) * state.track.playbackRate;
      const cur = elapsed % state.track.duration;
      const pct = (cur / state.track.duration) * 100;
      els.timelineProgress.style.width = `${pct}%`;
    }

    const centerX = canvasW / 2;
    const centerY = canvasH / 2;

    // Original Day 01 Pulse formula: Math.pow(Math.sin(t / 300), 8)
    const basePulse = Math.pow(Math.sin(animTime / 35), 8);
    const totalPulse = basePulse * 0.4 + smoothBass * 1.6;

    // 1. Concentric Beating Rings (Day 01 Pulse Signature)
    if (state.visMode === 'hybrid' || state.visMode === 'pulse') {
      const ringCount = 8;
      for (let i = 0; i < ringCount; i++) {
        const r = 50 + totalPulse * 160 + i * (35 + smoothBass * 25);
        ctx2d.beginPath();
        ctx2d.arc(centerX, centerY, r, 0, Math.PI * 2);

        const hue = (330 + i * 12 + animTime * 0.3) % 360;
        const alpha = Math.max(0.08, (1 - i / ringCount) * (0.3 + smoothBass * 0.7));
        ctx2d.strokeStyle = `hsla(${hue}, 92%, 62%, ${alpha})`;
        ctx2d.lineWidth = 2 + smoothBass * 4;
        ctx2d.stroke();
      }
    }

    // 2. Oscilloscope Glow Waveform
    if ((state.visMode === 'hybrid' || state.visMode === 'osc') && timeData) {
      ctx2d.beginPath();
      const sliceWidth = canvasW / timeData.length;
      let x = 0;

      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i] / 128.0;
        const y = centerY + (v - 1) * (180 + smoothBass * 140);

        if (i === 0) {
          ctx2d.moveTo(x, y);
        } else {
          ctx2d.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx2d.strokeStyle = '#00e5ff';
      ctx2d.lineWidth = 2.2;
      ctx2d.shadowColor = '#00e5ff';
      ctx2d.shadowBlur = 14;
      ctx2d.stroke();
      ctx2d.shadowBlur = 0; // Reset shadow
    }

    // 3. Frequency Spectrum Bars (Bottom / Circular)
    if ((state.visMode === 'hybrid' || state.visMode === 'spectrum') && freqData) {
      const bars = 64;
      const barWidth = canvasW / bars;
      for (let i = 0; i < bars; i++) {
        const val = freqData[i * 2] / 255;
        const barHeight = val * (canvasH * 0.32);
        const bx = i * barWidth;
        const by = canvasH - barHeight;

        const grad = ctx2d.createLinearGradient(0, by, 0, canvasH);
        grad.addColorStop(0, '#ff3366');
        grad.addColorStop(1, 'rgba(168, 85, 247, 0.2)');

        ctx2d.fillStyle = grad;
        ctx2d.fillRect(bx + 2, by, barWidth - 4, barHeight);
      }
    }
  }

  // --------------------------------------------------------------------------
  // EVENT LISTENERS & UI WIRING
  // --------------------------------------------------------------------------

  function setupEventListeners() {
    // Master controls
    els.masterPlayBtn.addEventListener('click', toggleMasterPlay);

    els.masterVolSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.masterVolume = val;
      if (masterGainNode && state.audioContext) {
        masterGainNode.gain.setValueAtTime(state.isMuted ? 0 : val, state.audioContext.currentTime);
      }
    });

    els.masterMuteBtn.addEventListener('click', () => {
      state.isMuted = !state.isMuted;
      els.masterMuteBtn.classList.toggle('active', state.isMuted);
      if (masterGainNode && state.audioContext) {
        masterGainNode.gain.setValueAtTime(state.isMuted ? 0 : state.masterVolume, state.audioContext.currentTime);
      }
    });

    // Toggle Dock Visibility
    els.btnToggleDock.addEventListener('click', () => {
      state.dockVisible = !state.dockVisible;
      els.controlDock.classList.toggle('hidden-dock', !state.dockVisible);
      els.btnToggleDock.querySelector('span').textContent = state.dockVisible ? 'Masquer Menu' : 'Afficher Menu';
    });

    // Visualizer Mode Buttons
    document.querySelectorAll('.pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.visMode = btn.dataset.mode;
      });
    });

    // Dock Tabs Switcher
    document.querySelectorAll('.dock-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dock-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.target);
        if (target) target.classList.add('active');
      });
    });

    // Synth Frequency Slider & Direct Input
    els.freqSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      // Map 0..1000 logarithmic to 20..20000 Hz
      const minL = Math.log(20);
      const maxL = Math.log(20000);
      const freq = Math.exp(minL + (val / 1000) * (maxL - minL));
      setSynthFrequency(freq);
    });

    els.freqInput.addEventListener('change', (e) => {
      setSynthFrequency(e.target.value);
    });

    // Frequency Nudge Buttons (-100, -10, -1, +1, +10, +100)
    document.querySelectorAll('.btn-nudge').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = parseFloat(btn.dataset.delta);
        setSynthFrequency(state.synth.frequency + delta);
      });
    });

    // Preset Frequency Chips
    document.querySelectorAll('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const hz = parseFloat(chip.dataset.freq);
        setSynthFrequency(hz);
        if (!state.synth.isPlaying) {
          startSynth();
        }
      });
    });

    // Waveform Buttons
    document.querySelectorAll('.wave-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wave-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.synth.waveform = btn.dataset.wave;
        if (state.synth.isPlaying) {
          startSynth(); // Rebuild graph for noise or waveform change
        }
      });
    });

    // Synth Pulse Mode
    els.synthPulseMode.addEventListener('change', (e) => {
      state.synth.pulseMode = e.target.value;
      if (state.synth.isPlaying) {
        startSynth();
      }
    });

    // Synth Pulse Rate (Hz / BPM)
    els.synthPulseRate.addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      state.synth.pulseRate = rate;
      const bpm = Math.round(rate * 60);
      els.synthPulseRateVal.textContent = `${rate.toFixed(1)} Hz (${bpm} BPM)`;
      els.statBpm.textContent = `${bpm} BPM`;

      if (state.synth.nodes.pulseLfo && state.audioContext) {
        state.synth.nodes.pulseLfo.frequency.setTargetAtTime(rate, state.audioContext.currentTime, 0.02);
      }
      if (state.synth.nodes.oscR && state.audioContext) {
        state.synth.nodes.oscR.frequency.setTargetAtTime(state.synth.frequency + rate, state.audioContext.currentTime, 0.02);
      }
    });

    // Synth Pulse Depth
    els.synthPulseDepth.addEventListener('input', (e) => {
      const depth = parseFloat(e.target.value);
      state.synth.pulseDepth = depth;
      els.synthPulseDepthVal.textContent = `${Math.round(depth * 100)}%`;
      if (state.synth.nodes.pulseLfoGain && state.audioContext) {
        state.synth.nodes.pulseLfoGain.gain.setTargetAtTime(depth * state.synth.gain, state.audioContext.currentTime, 0.02);
      }
    });

    // Synth Gain
    els.synthGainSlider.addEventListener('input', (e) => {
      const g = parseFloat(e.target.value);
      state.synth.gain = g;
      els.synthGainVal.textContent = `${Math.round(g * 100)}%`;
      if (state.synth.nodes.gain && state.audioContext) {
        state.synth.nodes.gain.gain.setTargetAtTime(g, state.audioContext.currentTime, 0.02);
      }
    });

    // Synth Toggle Play
    els.btnSynthToggle.addEventListener('click', () => {
      if (state.synth.isPlaying) {
        stopSynth();
      } else {
        startSynth();
      }
    });

    // ------------------------------------------------------------------------
    // Track Dropzone & File Handling
    // ------------------------------------------------------------------------

    els.dropzone.addEventListener('click', () => els.fileInput.click());

    els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      readFile(file);
    });

    els.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });

    els.dropzone.addEventListener('dragleave', () => {
      els.dropzone.classList.remove('dragover');
    });

    els.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) {
        readFile(file);
      }
    });

    function readFile(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        loadAudioBuffer(ev.target.result, file.name);
      };
      reader.readAsArrayBuffer(file);
    }

    // Load Synthesized Demo Groove
    els.btnDemoTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      createDemoGrooveBuffer();
    });

    // Track Play / Pause / Stop / Loop
    els.btnTrackPlay.addEventListener('click', () => {
      if (state.track.isPlaying) {
        pauseTrack();
      } else {
        playTrack();
      }
    });

    els.btnTrackStop.addEventListener('click', stopTrack);

    els.btnTrackLoop.addEventListener('click', () => {
      state.track.isLooping = !state.track.isLooping;
      if (state.track.sourceNode) {
        state.track.sourceNode.loop = state.track.isLooping;
      }
      updateTrackUI();
    });

    // Interactive Waveform Timeline Scrubber
    els.timelineBox.addEventListener('click', (e) => {
      const rect = els.timelineBox.getBoundingClientRect();
      const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTrack(clickRatio);
    });

    // Playback Speed / Pitch
    els.trackRateSlider.addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      setTrackRate(rate);
    });

    document.querySelectorAll('.chip-speed').forEach((chip) => {
      chip.addEventListener('click', () => {
        const rate = parseFloat(chip.dataset.rate);
        setTrackRate(rate);
      });
    });

    function setTrackRate(rate) {
      state.track.playbackRate = rate;
      els.trackRateSlider.value = rate;
      els.trackRateVal.textContent = `${rate.toFixed(2)}x`;

      document.querySelectorAll('.chip-speed').forEach((c) => {
        c.classList.toggle('active', parseFloat(c.dataset.rate) === rate);
      });

      if (state.track.sourceNode && state.audioContext) {
        state.track.sourceNode.playbackRate.setValueAtTime(rate, state.audioContext.currentTime);
      }
    }

    // Filter Type Selector
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.track.filterType = btn.dataset.filter;
        if (state.track.nodes.filter) {
          state.track.nodes.filter.type = state.track.filterType;
        }
      });
    });

    // Filter Cutoff Freq Slider
    els.filterFreqSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      // Logarithmic mapping 20..20000 Hz
      const minL = Math.log(20);
      const maxL = Math.log(20000);
      const freq = Math.exp(minL + (val / 1000) * (maxL - minL));
      state.track.filterFreq = freq;
      els.filterFreqVal.textContent = `${freq.toFixed(0)} Hz`;

      if (state.track.nodes.filter && state.audioContext) {
        state.track.nodes.filter.frequency.setTargetAtTime(freq, state.audioContext.currentTime, 0.015);
      }
    });

    // Filter Q Resonance
    els.filterQSlider.addEventListener('input', (e) => {
      const q = parseFloat(e.target.value);
      state.track.filterQ = q;
      els.filterQVal.textContent = q.toFixed(1);

      if (state.track.nodes.filter && state.audioContext) {
        state.track.nodes.filter.Q.setTargetAtTime(q, state.audioContext.currentTime, 0.015);
      }
    });

    // Distortion Overdrive
    els.trackDistSlider.addEventListener('input', (e) => {
      const d = parseFloat(e.target.value);
      state.track.distortion = d;
      els.trackDistVal.textContent = `${Math.round(d * 100)}%`;

      if (state.track.nodes.waveshaper) {
        state.track.nodes.waveshaper.curve = makeDistortionCurve(d);
      }
    });

    // Delay Echo Time & Feedback
    els.trackDelaySlider.addEventListener('input', (e) => {
      const ms = parseFloat(e.target.value);
      const sec = ms / 1000;
      state.track.delayTime = sec;
      els.trackDelayVal.textContent = `${ms} ms`;

      if (state.track.nodes.delay && state.audioContext) {
        state.track.nodes.delay.delayTime.setTargetAtTime(sec, state.audioContext.currentTime, 0.02);
      }
    });

    els.trackDelayFbSlider.addEventListener('input', (e) => {
      const fb = parseFloat(e.target.value);
      state.track.delayFeedback = fb;
      els.trackDelayFbVal.textContent = `${Math.round(fb * 100)}%`;

      if (state.track.nodes.delayFeedbackGain && state.audioContext) {
        state.track.nodes.delayFeedbackGain.gain.setTargetAtTime(fb, state.audioContext.currentTime, 0.02);
      }
    });

    // Track Volume
    els.trackVolSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      state.track.volume = vol;
      els.trackVolVal.textContent = `${Math.round(vol * 100)}%`;

      if (state.track.nodes.gain && state.audioContext) {
        state.track.nodes.gain.gain.setTargetAtTime(vol, state.audioContext.currentTime, 0.02);
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleMasterPlay();
      } else if (e.code === 'KeyM') {
        state.isMuted = !state.isMuted;
        els.masterMuteBtn.classList.toggle('active', state.isMuted);
        if (masterGainNode && state.audioContext) {
          masterGainNode.gain.setValueAtTime(state.isMuted ? 0 : state.masterVolume, state.audioContext.currentTime);
        }
      } else if (e.code === 'KeyH') {
        state.dockVisible = !state.dockVisible;
        els.controlDock.classList.toggle('hidden-dock', !state.dockVisible);
        els.btnToggleDock.querySelector('span').textContent = state.dockVisible ? 'Masquer Menu' : 'Afficher Menu';
      }
    });
  }

  // Initial Boot
  setupEventListeners();
  setSynthFrequency(432); // Default to 432 Hz
  renderVisualizer();

})();
