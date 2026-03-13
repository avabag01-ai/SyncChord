/// BPM detection via energy onset autocorrelation.
/// Expects mono f32 samples at 44100 Hz.

const SAMPLE_RATE: f32 = 44100.0;
const HOP_SIZE: usize = 512;
const MIN_BPM: f32 = 60.0;
const MAX_BPM: f32 = 200.0;

/// Compute RMS energy for each hop-sized frame.
fn compute_energy_envelope(samples: &[f32]) -> Vec<f32> {
    samples
        .chunks(HOP_SIZE)
        .map(|chunk| {
            let sum: f32 = chunk.iter().map(|s| s * s).sum();
            (sum / chunk.len() as f32).sqrt()
        })
        .collect()
}

/// Compute onset strength: half-wave rectified first-order difference of energy.
fn onset_strength(energy: &[f32]) -> Vec<f32> {
    if energy.len() < 2 {
        return vec![];
    }
    energy
        .windows(2)
        .map(|w| (w[1] - w[0]).max(0.0))
        .collect()
}

/// Autocorrelation-based BPM estimation.
/// Returns estimated BPM (f32). Returns 0.0 if insufficient data.
pub fn estimate_bpm(samples: &[f32]) -> f32 {
    let energy = compute_energy_envelope(samples);
    let onset = onset_strength(&energy);

    if onset.len() < 64 {
        return 0.0;
    }

    // Frames per second at hop rate
    let fps = SAMPLE_RATE / HOP_SIZE as f32;

    // Lag range corresponding to BPM range
    let min_lag = (fps * 60.0 / MAX_BPM) as usize;
    let max_lag = (fps * 60.0 / MIN_BPM) as usize;
    let max_lag = max_lag.min(onset.len() - 1);

    if min_lag >= max_lag {
        return 0.0;
    }

    // Normalized autocorrelation
    let n = onset.len();
    let mut best_lag = min_lag;
    let mut best_corr: f32 = f32::NEG_INFINITY;

    for lag in min_lag..=max_lag {
        let mut corr: f32 = 0.0;
        let count = n - lag;
        for i in 0..count {
            corr += onset[i] * onset[i + lag];
        }
        corr /= count as f32;
        if corr > best_corr {
            best_corr = corr;
            best_lag = lag;
        }
    }

    if best_corr <= 0.0 {
        return 0.0;
    }

    // Convert lag (in frames) to BPM
    let bpm = 60.0 * fps / best_lag as f32;
    bpm
}
