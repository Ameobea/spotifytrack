use fnv::FnvHashMap as HashMap;
use std::{convert::TryInto, sync::Once};

pub mod map_3d;

#[derive(Clone)]
pub struct ArtistPos<const DIMS: usize> {
    pub pos: [f32; DIMS],
    pub normalized_pos: [f32; DIMS],
}

impl<const DIMS: usize> ArtistPos<DIMS> {
    pub fn new(pos: [f32; DIMS]) -> Self {
        ArtistPos {
            pos,
            normalized_pos: normalize_vector(&pos),
        }
    }
}

#[derive(Clone)]
pub struct ArtistEmbeddingContext<const DIMS: usize> {
    pub artist_position_by_id: HashMap<usize, ArtistPos<DIMS>>,
    pub sorted_artist_ids: Vec<usize>,
}

impl<const DIMS: usize> ArtistEmbeddingContext<DIMS> {
    pub fn new(artist_position_by_id: HashMap<usize, ArtistPos<DIMS>>) -> Self {
        let mut sorted_artist_ids = artist_position_by_id.keys().cloned().collect::<Vec<_>>();
        sorted_artist_ids.sort_unstable();
        ArtistEmbeddingContext {
            artist_position_by_id,
            sorted_artist_ids,
        }
    }

    pub fn get_positions<'a>(
        &'a self,
        id_1: usize,
        id_2: usize,
    ) -> Result<(&'a ArtistPos<DIMS>, &'a ArtistPos<DIMS>), ArtistEmbeddingError> {
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

    /// Serializes to an efficient binary format with the following format:
    ///
    /// 1 * u32: number of artists
    /// [number of artists] * u32: artist internal ids
    /// [number of artists] * DIMS * f32: artist positions
    /// (OPTIONAL) [number of artists] * u8: artist popularity 0-100
    pub fn serialize_to_packed_binary(
        &self,
        artist_popularities_by_id: Option<HashMap<i32, u8>>,
    ) -> Vec<u8> {
        let mut pairs: Vec<(u32, ArtistPos<DIMS>)> = self
            .artist_position_by_id
            .iter()
            .map(|(&id, pos)| {
                let id: u32 = id.try_into().expect("Artist id greater than u32::MAX");
                (id, pos.clone())
            })
            .collect();

        // Sort the pairs to maybe increase compression ratio who knows
        pairs.sort_unstable_by_key(|(id, _pos)| *id);

        let packed_byte_size = 4
            + (pairs.len() * 4)
            + (pairs.len() * DIMS * 4)
            + if artist_popularities_by_id.is_some() {
                pairs.len()
            } else {
                0
            };
        let mut packed: Vec<u8> = Vec::with_capacity(packed_byte_size);
        unsafe { packed.set_len(packed_byte_size) };

        unsafe {
            let mut ptr: *mut u32 = packed.as_mut_ptr() as *mut u32;

            // Write the length
            ptr.write(pairs.len() as u32);

            // Write IDs
            ptr = ptr.add(1);
            for (i, (id, _pos)) in pairs.iter().enumerate() {
                ptr.add(i).write((*id) as u32);
            }

            // Write positions
            let ptr = ptr.add(pairs.len()) as *mut f32;

            for (i, (_id, pos)) in pairs.iter().enumerate() {
                for (dim_ix, val_for_dim) in pos.pos.iter().enumerate() {
                    ptr.add(i * DIMS + dim_ix).write(*val_for_dim);
                }
            }

            // Write popularities if provided
            if let Some(popularities) = artist_popularities_by_id {
                let ptr = ptr.add(pairs.len() * DIMS) as *mut u8;
                for (i, (id, _)) in pairs.iter().enumerate() {
                    let popularity = popularities.get(&(*id as i32)).copied().unwrap_or(0);
                    ptr.add(i).write(popularity);
                }
            }
        }

        packed
    }
}

static mut ARTIST_EMBEDDING_CTX: *const ArtistEmbeddingContext<8> = std::ptr::null();

pub fn get_artist_embedding_ctx() -> &'static ArtistEmbeddingContext<8> {
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
fn normalize_vector<const DIMS: usize>(v: &[f32; DIMS]) -> [f32; DIMS] {
    let mut out: [f32; DIMS] = [0.; DIMS];

    let sum_of_squares = v.iter().map(|&x| x * x).fold(0.0f32, |acc, x| acc + x);
    let divisor = sum_of_squares.sqrt();
    for i in 0..v.len() {
        out[i] = v[i] / divisor;
    }

    out
}

/// Just dot product of l2-normalized positions
fn cosine_similarity<const DIMS: usize>(
    normalized_v1: &[f32; DIMS],
    normalized_v2: &[f32; DIMS],
) -> f32 {
    let mut sum = 0.;
    for i in 0..normalized_v1.len() {
        sum += normalized_v1[i] * normalized_v2[i];
    }
    sum
}

fn weighted_midpoint<const DIMS: usize>(
    v1: &[f32; DIMS],
    v1_bias: f32,
    v2: &[f32; DIMS],
    v2_bias: f32,
) -> [f32; DIMS] {
    let mut out: [f32; DIMS] = [0.; DIMS];
    for i in 0..v1.len() {
        out[i] = (v1[i] * v1_bias + v2[i] * v2_bias) / 2.
    }
    out
}

fn distance<const DIMS: usize>(v1: &[f32; DIMS], v2: &[f32; DIMS]) -> f32 {
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
    artist_1_bias: f32,
    artist_2_id: usize,
    artist_2_bias: f32,
    count: usize,
) -> Result<Vec<AverageArtistDescriptor>, ArtistEmbeddingError> {
    let mut out = vec![AverageArtistDescriptor::new_placeholder(); count];

    let ctx = get_artist_embedding_ctx();
    let (pos_1, pos_2) = ctx.get_positions(artist_1_id, artist_2_id)?;
    let midpoint = weighted_midpoint(&pos_1.pos, artist_1_bias, &pos_2.pos, artist_2_bias);
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
            similarity_to_artist_1: cosine_similarity(&pos.normalized_pos, &pos_1.normalized_pos),
            similarity_to_artist_2: cosine_similarity(&pos.normalized_pos, &pos_2.normalized_pos),
        };

        worst_retained_similarity = out.last().unwrap().similarity_to_target_point;
    }

    Ok(out)
}

static ARTIST_EMBEDDING_INITIALIZED: Once = Once::new();

fn parse_positions<const DIMS: usize>(raw_positions: &str) -> HashMap<usize, ArtistPos<DIMS>> {
    let mut positions_by_id: HashMap<usize, ArtistPos<DIMS>> = HashMap::default();

    for line in raw_positions.lines().skip(1) {
        if line.is_empty() {
            continue;
        }

        let mut artist_id = 0usize;
        let mut pos: [f32; DIMS] = [0.; DIMS];
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
    println!("Successfully fetched artist embedding positions.  Parsing...");
    let artist_position_by_id = parse_positions(&raw_positions);
    println!("Successfully parsed artist embedding positions.  Setting into global context.");

    let ctx = box ArtistEmbeddingContext::new(artist_position_by_id);
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
