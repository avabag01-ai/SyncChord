/// Chord recognition via template matching against chromagram.
/// Supports 24 chords: 12 major + 12 minor.

const PITCH_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Major chord template: root(0), major 3rd(4), perfect 5th(7)
const MAJOR_INTERVALS: [usize; 3] = [0, 4, 7];
/// Minor chord template: root(0), minor 3rd(3), perfect 5th(7)
const MINOR_INTERVALS: [usize; 3] = [0, 3, 7];

pub struct ChordResult {
    pub name: String,
    pub confidence: f32,
}

/// Build a 12-element template vector for a chord with given root and intervals.
fn build_template(root: usize, intervals: &[usize]) -> [f32; 12] {
    let mut tpl = [0.0f32; 12];
    for &iv in intervals {
        tpl[(root + iv) % 12] = 1.0;
    }
    tpl
}

/// Cosine similarity between two 12-dim vectors.
fn cosine_similarity(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a < 1e-9 || norm_b < 1e-9 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

/// Estimate chord from a 12-bin chromagram.
/// Returns chord name and confidence (0.0 ~ 1.0).
pub fn estimate_chord(chroma: &[f32; 12]) -> ChordResult {
    let mut best_name = String::from("N/C");
    let mut best_score: f32 = 0.0;

    for root in 0..12 {
        // Major
        let major_tpl = build_template(root, &MAJOR_INTERVALS);
        let score = cosine_similarity(chroma, &major_tpl);
        if score > best_score {
            best_score = score;
            best_name = PITCH_NAMES[root].to_string();
        }

        // Minor
        let minor_tpl = build_template(root, &MINOR_INTERVALS);
        let score = cosine_similarity(chroma, &minor_tpl);
        if score > best_score {
            best_score = score;
            best_name = format!("{}m", PITCH_NAMES[root]);
        }
    }

    ChordResult {
        name: best_name,
        confidence: best_score,
    }
}
