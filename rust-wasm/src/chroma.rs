use rustfft::{num_complex::Complex, FftPlanner};

const SAMPLE_RATE: f32 = 44100.0;
const FFT_SIZE: usize = 4096;
const NUM_PITCH_CLASSES: usize = 12;

// Pitch class names: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
// A4 = 440 Hz reference

/// Compute 12-bin chromagram from raw audio samples.
/// Input: mono f32 samples (at least FFT_SIZE).
/// Output: [f32; 12] energy per pitch class (C..B), normalized.
pub fn compute_chroma(samples: &[f32]) -> [f32; NUM_PITCH_CLASSES] {
    let n = samples.len().min(FFT_SIZE);
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);

    // Apply Hann window and prepare complex buffer
    let mut buffer: Vec<Complex<f32>> = (0..FFT_SIZE)
        .map(|i| {
            let sample = if i < n { samples[i] } else { 0.0 };
            let window = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos());
            Complex::new(sample * window, 0.0)
        })
        .collect();

    fft.process(&mut buffer);

    // Compute magnitude spectrum (first half)
    let half = FFT_SIZE / 2;
    let magnitudes: Vec<f32> = buffer[..half]
        .iter()
        .map(|c| (c.re * c.re + c.im * c.im).sqrt())
        .collect();

    // Map frequency bins to pitch classes
    let mut chroma = [0.0f32; NUM_PITCH_CLASSES];
    for (bin_idx, &mag) in magnitudes.iter().enumerate().skip(1) {
        let freq = bin_idx as f32 * SAMPLE_RATE / FFT_SIZE as f32;
        if freq < 65.0 || freq > 2100.0 {
            continue; // Focus on musically relevant range (C2 ~ C7)
        }
        // Convert frequency to pitch class
        // pitch_class = round(12 * log2(freq / C0)) mod 12
        // C0 ≈ 16.35 Hz
        let semitones = 12.0 * (freq / 16.3516).log2();
        let pitch_class = ((semitones.round() as i32) % 12 + 12) % 12;
        chroma[pitch_class as usize] += mag * mag; // Energy (magnitude squared)
    }

    // Normalize
    let max = chroma.iter().cloned().fold(0.0f32, f32::max);
    if max > 0.0 {
        for c in &mut chroma {
            *c /= max;
        }
    }

    chroma
}
