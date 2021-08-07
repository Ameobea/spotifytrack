use std::{collections::HashMap, sync::Once};

pub struct ArtistPos {
    pub pos: [f32; 8],
    pub normalized_pos: [f32; 8],
}

impl ArtistPos {
    pub fn new(pos: [f32; 8]) -> Self {
        ArtistPos {
            pos,
            normalized_pos: normalize_vector(&pos),
        }
    }
}

pub struct ArtistEmbeddingContext {
    pub artist_position_by_id: HashMap<usize, ArtistPos>,
}

impl ArtistEmbeddingContext {
    pub fn get_positions<'a>(
        &'a self,
        id_1: usize,
        id_2: usize,
    ) -> Result<(&'a ArtistPos, &'a ArtistPos), ArtistEmbeddingError> {
        let pos_1 = match self.artist_position_by_id.get(&id_1) {
            Some(id) => id,
            None => {
                error!("Artist internal id={} not found in embedding", id_1);
                return Err(ArtistEmbeddingError::ArtistIdNotFound(id_1));
            },
        };
        let pos_2 = match self.artist_position_by_id.get(&id_2) {
            Some(id) => id,
            None => {
                error!("Artist internal id={} not found in embedding", id_2);
                return Err(ArtistEmbeddingError::ArtistIdNotFound(id_2));
            },
        };

        Ok((pos_1, pos_2))
    }

    pub fn distance(&self, id_1: usize, id_2: usize) -> Result<f32, ArtistEmbeddingError> {
        let (pos_1, pos_2) = self.get_positions(id_1, id_2)?;
        Ok(distance(&pos_1.pos, &pos_2.pos))
    }

    pub fn similarity(&self, id_1: usize, id_2: usize) -> Result<f32, ArtistEmbeddingError> {
        let (pos_1, pos_2) = self.get_positions(id_1, id_2)?;
        Ok(cosine_similarity(
            &pos_1.normalized_pos,
            &pos_2.normalized_pos,
        ))
    }
}

static mut ARTIST_EMBEDDING_CTX: *const ArtistEmbeddingContext = std::ptr::null();

pub fn get_artist_embedding_ctx() -> &'static ArtistEmbeddingContext {
    unsafe { &*ARTIST_EMBEDDING_CTX }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AverageArtistDescriptor {
    pub id: usize,
    pub similarity_to_target_point: f32,
    pub similarity_to_artist_1: f32,
    pub similarity_to_artist_2: f32,
}

impl AverageArtistDescriptor {
    pub fn new_placeholder() -> Self {
        AverageArtistDescriptor {
            id: std::usize::MAX,
            similarity_to_target_point: std::f32::NEG_INFINITY,
            similarity_to_artist_1: std::f32::NEG_INFINITY,
            similarity_to_artist_2: std::f32::NEG_INFINITY,
        }
    }
}

/// l2 normalization
fn normalize_vector(v: &[f32; 8]) -> [f32; 8] {
    let mut out: [f32; 8] = Default::default();

    let sum_of_squares = v.iter().map(|&x| x * x).fold(0.0f32, |acc, x| acc + x);
    let divisor = sum_of_squares.sqrt();
    for i in 0..v.len() {
        out[i] = v[i] / divisor;
    }

    out
}

/// Just dot product of l2-normalized positions
fn cosine_similarity(normalized_v1: &[f32; 8], normalized_v2: &[f32; 8]) -> f32 {
    let mut sum = 0.;
    for i in 0..normalized_v1.len() {
        sum += normalized_v1[i] * normalized_v2[i];
    }
    sum
}

fn midpoint(v1: &[f32; 8], v2: &[f32; 8]) -> [f32; 8] {
    let mut out: [f32; 8] = Default::default();
    for i in 0..v1.len() {
        out[i] = (v1[i] + v2[i]) / 2.
    }
    out
}

fn distance(v1: &[f32; 8], v2: &[f32; 8]) -> f32 {
    v1.iter()
        .zip(v2.iter())
        .fold(0., |acc, (&v1_n, &v2_n)| {
            acc + (v2_n - v1_n) * (v2_n - v1_n)
        })
        .sqrt()
}

#[derive(Debug)]
pub enum ArtistEmbeddingError {
    ArtistIdNotFound(usize),
}

pub fn get_average_artists(
    artist_1_id: usize,
    artist_2_id: usize,
    count: usize,
) -> Result<Vec<AverageArtistDescriptor>, ArtistEmbeddingError> {
    let mut out = vec![AverageArtistDescriptor::new_placeholder(); count];

    let ctx = get_artist_embedding_ctx();
    let (pos_1, pos_2) = ctx.get_positions(artist_1_id, artist_2_id)?;
    let midpoint = midpoint(&pos_1.pos, &pos_2.pos);
    let normalized_midpoint = normalize_vector(&midpoint);

    let mut worst_retained_similarity = std::f32::NEG_INFINITY;
    // Compute cosine distances between the midpoint and all artists.  Retain the top `count`
    // artists with the highest similarities to the midpoint.
    for (&id, pos) in ctx.artist_position_by_id.iter() {
        if id == artist_1_id || id == artist_2_id {
            continue;
        }

        let similarity = cosine_similarity(&normalized_midpoint, &pos.normalized_pos);
        if similarity < worst_retained_similarity {
            continue;
        }

        // We've found a similarity higher than at least one of the existing matches.  Find out
        // where it belongs in the top list, shift all others down, and drop the worst one.
        let pos_to_replace = out
            .iter()
            .position(|d| d.similarity_to_target_point < similarity)
            .unwrap();
        for i in ((pos_to_replace + 1)..out.len()).rev() {
            out[i] = out[i - 1].clone();
        }
        out[pos_to_replace] = AverageArtistDescriptor {
            id,
            similarity_to_target_point: similarity,
            similarity_to_artist_1: cosine_similarity(&normalized_midpoint, &pos_1.normalized_pos),
            similarity_to_artist_2: cosine_similarity(&normalized_midpoint, &pos_2.normalized_pos),
        };

        worst_retained_similarity = out.last().unwrap().similarity_to_target_point;
    }

    Ok(out)
}

static ARTIST_EMBEDDING_INITIALIZED: Once = Once::new();

fn parse_positions(raw_positions: &str) -> HashMap<usize, ArtistPos> {
    let mut positions_by_id: HashMap<usize, ArtistPos> = HashMap::new();

    for line in raw_positions.lines().skip(1) {
        if line.is_empty() {
            continue;
        }

        let mut artist_id = 0usize;
        let mut pos: [f32; 8] = Default::default();
        for (i, part) in line.split_ascii_whitespace().enumerate() {
            if i == 0 {
                artist_id = part
                    .parse()
                    .expect("Invalid artist ID found in raw positions");
                continue;
            }

            let i = i - 1;
            assert!(i < pos.len());
            pos[i] = part.parse().expect("Invalid value for dim in pos");
        }

        positions_by_id.insert(artist_id, ArtistPos::new(pos));
    }

    positions_by_id
}

pub async fn init_artist_embedding_ctx(positions_url: &str) {
    let mut should_initialize = false;
    ARTIST_EMBEDDING_INITIALIZED.call_once(|| {
        should_initialize = true;
    });

    if !should_initialize {
        return;
    }

    println!(
        "Initializing artist embedding ctx.  Fetching pre-computed positions from URL={}...",
        positions_url
    );
    let raw_positions: String = reqwest::get(positions_url)
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    println!("Successfully parsed artst embedding positions.  Parsing...");
    let artist_position_by_id = parse_positions(&raw_positions);
    println!("Successfully parsed artist embedding positions.  Setting into global context.");
    let ctx = box ArtistEmbeddingContext {
        artist_position_by_id,
    };
    unsafe { ARTIST_EMBEDDING_CTX = Box::into_raw(ctx) };
}

#[test]
fn test_cosine_similarity_accuracy() {
    let x: [f32; 8] = [0., 1., 2., 3., 4., 5., 6., 7.];
    let y: [f32; 8] = [0.5, 1.2, 2., 3., -1., 0., 6., 7.];

    let normalized_x = dbg!(normalize_vector(&x));
    let normalized_y = dbg!(normalize_vector(&y));

    let actual = cosine_similarity(&normalized_x, &normalized_y);
    let expected = 0.80182517;
    assert_eq!(actual, expected);
}
