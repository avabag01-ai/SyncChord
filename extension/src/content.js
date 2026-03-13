/**
 * SyncChord Content Script
 * Injected into YouTube pages. Captures audio, runs WASM analysis,
 * and renders chord overlay on the video player.
 */

(function () {
  'use strict';

  let audioCtx = null;
  let analyserNode = null;
  let sourceNode = null;
  let wasmModule = null;
  let isAnalyzing = false;
  let animFrameId = null;
  let currentChord = 'N/C';
  let currentConfidence = 0;
  let currentBpm = 0;
  let chordHistory = [];
  const MAX_HISTORY = 4;

  // ── Overlay UI ──────────────────────────────────────────────

  function createOverlay() {
    if (document.getElementById('syncchord-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'syncchord-overlay';
    overlay.innerHTML = `
      <div class="sc-chord-bar">
        <div class="sc-chord sc-chord-prev" id="sc-prev-chord">—</div>
        <div class="sc-chord sc-chord-current" id="sc-current-chord">N/C</div>
        <div class="sc-chord sc-chord-next" id="sc-next-chord">—</div>
      </div>
      <div class="sc-info-bar">
        <span class="sc-bpm" id="sc-bpm">— BPM</span>
        <span class="sc-confidence" id="sc-confidence">0%</span>
        <span class="sc-sync" id="sc-sync">🔴 오프라인</span>
      </div>
    `;

    // Insert below the video player
    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (player) {
      player.style.position = 'relative';
      player.appendChild(overlay);
    }
  }

  function updateOverlayUI() {
    const el = (id) => document.getElementById(id);
    const cur = el('sc-current-chord');
    if (cur) cur.textContent = currentChord;

    const conf = el('sc-confidence');
    if (conf) conf.textContent = `${Math.round(currentConfidence * 100)}%`;

    const bpmEl = el('sc-bpm');
    if (bpmEl) bpmEl.textContent = currentBpm > 0 ? `${Math.round(currentBpm)} BPM` : '— BPM';

    // History: show previous and next predicted
    const prevEl = el('sc-prev-chord');
    if (prevEl && chordHistory.length >= 2) {
      prevEl.textContent = chordHistory[chordHistory.length - 2];
    }
  }

  // ── Audio Capture ───────────────────────────────────────────

  function initAudio() {
    const video = document.querySelector('video');
    if (!video) return false;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    }
    if (!sourceNode) {
      sourceNode = audioCtx.createMediaElementSource(video);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 8192;
      sourceNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);
    }
    return true;
  }

  // ── WASM Loading ────────────────────────────────────────────

  async function loadWasm() {
    try {
      const wasmUrl = chrome.runtime.getURL('wasm/syncchord_wasm.js');
      wasmModule = await import(wasmUrl);
      await wasmModule.default();
      console.log('[SyncChord] WASM loaded');
      return true;
    } catch (e) {
      console.warn('[SyncChord] WASM load failed, using JS fallback:', e.message);
      return false;
    }
  }

  // ── JS Fallback Chord Detection ─────────────────────────────

  function jsFallbackAnalyze(samples) {
    // Simple energy-based pitch detection as fallback
    const n = samples.length;
    if (n < 2048) return { chord: 'N/C', confidence: 0, bpm: 0 };

    // Compute rough chromagram via DFT at specific frequencies
    const noteFreqs = [
      261.63, 277.18, 293.66, 311.13, 329.63, 349.23,
      369.99, 392.00, 415.30, 440.00, 466.16, 493.88
    ];
    const chroma = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      const freq = noteFreqs[i];
      let realSum = 0, imagSum = 0;
      for (let j = 0; j < n; j++) {
        const angle = 2 * Math.PI * freq * j / 44100;
        realSum += samples[j] * Math.cos(angle);
        imagSum += samples[j] * Math.sin(angle);
      }
      chroma[i] = Math.sqrt(realSum * realSum + imagSum * imagSum) / n;
    }

    // Normalize
    let max = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
    if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;

    // Template matching (major + minor)
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const majorIv = [0, 4, 7];
    const minorIv = [0, 3, 7];
    let bestName = 'N/C', bestScore = 0;

    for (let root = 0; root < 12; root++) {
      for (const [suffix, intervals] of [['', majorIv], ['m', minorIv]]) {
        const tpl = new Float32Array(12);
        for (const iv of intervals) tpl[(root + iv) % 12] = 1.0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < 12; i++) {
          dot += chroma[i] * tpl[i];
          na += chroma[i] * chroma[i];
          nb += tpl[i] * tpl[i];
        }
        const score = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
        if (score > bestScore) {
          bestScore = score;
          bestName = names[root] + suffix;
        }
      }
    }

    return { chord: bestName, confidence: bestScore, bpm: 0 };
  }

  // ── Analysis Loop ───────────────────────────────────────────

  let frameCounter = 0;
  const CHORD_INTERVAL = 3;  // Analyze every 3rd frame (~100ms at 30fps)
  const BPM_INTERVAL = 90;   // BPM every ~3 seconds
  let bpmBuffer = [];

  function analyzeFrame() {
    if (!isAnalyzing) return;

    frameCounter++;
    const bufferLength = analyserNode.fftSize;
    const timeDomain = new Float32Array(bufferLength);
    analyserNode.getFloatTimeDomainData(timeDomain);

    // Accumulate for BPM
    bpmBuffer.push(...timeDomain.slice(0, 4096));
    if (bpmBuffer.length > 44100 * 4) {
      bpmBuffer = bpmBuffer.slice(-44100 * 4);
    }

    if (frameCounter % CHORD_INTERVAL === 0) {
      const samples = timeDomain.slice(0, 4096);
      let result;

      if (wasmModule && wasmModule.analyze_chord) {
        try {
          const r = wasmModule.analyze_chord(samples);
          result = { chord: r.chord, confidence: r.confidence, bpm: 0 };
        } catch {
          result = jsFallbackAnalyze(samples);
        }
      } else {
        result = jsFallbackAnalyze(samples);
      }

      if (result.confidence > 0.3) {
        if (result.chord !== currentChord) {
          chordHistory.push(currentChord);
          if (chordHistory.length > MAX_HISTORY) chordHistory.shift();
        }
        currentChord = result.chord;
        currentConfidence = result.confidence;
      }
    }

    // BPM analysis (less frequent)
    if (frameCounter % BPM_INTERVAL === 0 && bpmBuffer.length > 44100 * 2) {
      const bpmSamples = new Float32Array(bpmBuffer);
      if (wasmModule && wasmModule.analyze_chunk) {
        try {
          const r = wasmModule.analyze_chunk(bpmSamples);
          if (r.bpm > 0) currentBpm = r.bpm;
        } catch { /* ignore */ }
      }
    }

    updateOverlayUI();
    animFrameId = requestAnimationFrame(analyzeFrame);
  }

  // ── Start/Stop ──────────────────────────────────────────────

  async function start() {
    createOverlay();
    if (!initAudio()) {
      console.warn('[SyncChord] No video element found');
      return;
    }
    await loadWasm();
    isAnalyzing = true;
    analyzeFrame();
    console.log('[SyncChord] Analysis started');
  }

  function stop() {
    isAnalyzing = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    console.log('[SyncChord] Analysis stopped');
  }

  // ── Message Listener (from popup) ──────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'start') {
      start();
      sendResponse({ status: 'started' });
    } else if (msg.action === 'stop') {
      stop();
      sendResponse({ status: 'stopped' });
    } else if (msg.action === 'getState') {
      sendResponse({
        chord: currentChord,
        confidence: currentConfidence,
        bpm: currentBpm,
        analyzing: isAnalyzing,
      });
    }
    return true;
  });

  // ── Auto-start on YouTube watch page ───────────────────────

  if (window.location.pathname === '/watch') {
    // Wait for video element to load
    const observer = new MutationObserver(() => {
      if (document.querySelector('video')) {
        observer.disconnect();
        setTimeout(start, 1500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
