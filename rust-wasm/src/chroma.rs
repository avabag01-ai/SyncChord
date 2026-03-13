use rustfft::{num_complex::Complex, FftPlanner};

const FFT_SIZE: usize = 4096;
const NUM_PITCH_CLASSES: usize = 12;

/// Compute 12-bin chromagram with explicit sample rate.
pub fn compute_chroma_sr(samples: &[f32], sample_rate: f32) -> [f32; NUM_PITCH_CLASSES] {
    let n = samples.len().min(FFT_SIZE);
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);

    // Apply Hann window and prepare complex buffer
    let mut buffer: Vec<Complex<f32>> = (0..FFT_SIZE)
        .map(|i| {
            let sample = if i < n { samples[i] } else { 0.0 };
            let window =
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos());
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

    // Map frequency bins to pitch classes using MIDI note formula
    let mut chroma = [0.0f32; NUM_PITCH_CLASSES];
    let bin_hz = sample_rate / FFT_SIZE as f32;

    for (bin_idx, &mag) in magnitudes.iter().enumerate().skip(1) {
        let freq = bin_idx as f32 * bin_hz;
        if freq < 65.0 || freq > 2100.0 {
            continue;
        }
        if mag < 1e-6 {
            continue;
        }
        // MIDI note: 12 * log2(freq/440) + 69
        let midi = 12.0 * (freq / 440.0).log2() + 69.0;
        let pitch_class = ((midi.round() as i32) % 12 + 12) % 12;
        chroma[pitch_class as usize] += mag * mag;
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

/// Legacy: compute chroma assuming 44100 Hz.
pub fn compute_chroma(samples: &[f32]) -> [f32; NUM_PITCH_CLASSES] {
    compute_chroma_sr(samples, 44100.0)
}
