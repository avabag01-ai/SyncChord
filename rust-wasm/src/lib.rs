mod beat;
mod chord;
mod chroma;

use wasm_bindgen::prelude::*;

/// Result returned to JavaScript.
#[wasm_bindgen]
pub struct AnalysisResult {
    chord: String,
    confidence: f32,
    bpm: f32,
}

#[wasm_bindgen]
impl AnalysisResult {
    #[wasm_bindgen(getter)]
    pub fn chord(&self) -> String {
        self.chord.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn confidence(&self) -> f32 {
        self.confidence
    }

    #[wasm_bindgen(getter)]
    pub fn bpm(&self) -> f32 {
        self.bpm
    }
}

/// Analyze an audio chunk with explicit sample rate.
#[wasm_bindgen]
pub fn analyze_chunk(samples: &[f32], sample_rate: f32) -> AnalysisResult {
    let chroma = chroma::compute_chroma_sr(samples, sample_rate);
    let chord_result = chord::estimate_chord(&chroma);
    let bpm = beat::estimate_bpm(samples);

    AnalysisResult {
        chord: chord_result.name,
        confidence: chord_result.confidence,
        bpm,
    }
}

/// Analyze chord only (lighter, for frequent calls).
#[wasm_bindgen]
pub fn analyze_chord(samples: &[f32], sample_rate: f32) -> AnalysisResult {
    let chroma = chroma::compute_chroma_sr(samples, sample_rate);
    let chord_result = chord::estimate_chord(&chroma);

    AnalysisResult {
        chord: chord_result.name,
        confidence: chord_result.confidence,
        bpm: 0.0,
    }
}
