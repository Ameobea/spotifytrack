#![allow(invalid_value)]

#[macro_use]
extern crate log;

use std::{collections::VecDeque, sync::Once};

use bitflags::bitflags;
use coloring::COLOR_NOISE_SEED;
use float_ord::FloatOrd;
use fnv::{FnvHashMap as HashMap, FnvHashSet as HashSet};
use noise::Seedable;
use rand::{seq::SliceRandom, Rng, SeedableRng};
use wasm_bindgen::prelude::*;

mod coloring;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Math, js_name = random)]
    fn js_random() -> f64;
}

bitflags! {
    pub struct ArtistRenderState: u8 {
        const RENDER_LABEL = 0b0000_0001;
        const RENDER_CONNECTIONS = 0b0000_0010;
        /// Should actually render the artist
        const RENDER_GEOMETRY = 0b0000_0100;
        /// Name has been received from spotify and we can actually render it
        const HAS_NAME = 0b0000_1000;
        const IS_HIGHLIGHTED = 0b0001_0000;
    }
}

#[derive(Clone)]
pub struct ArtistState {
    pub position: [f32; 3],
    pub popularity: u8,
    pub render_state: ArtistRenderState,
}

#[derive(Default)]
pub struct ArtistRelationship {
    pub related_artist_index: usize,
    pub connections_buffer_index: Option<usize>,
}

#[derive(Default)]
pub struct ArtistRelationships {
    pub count: usize,
    pub related_artist_indices: [ArtistRelationship; MAX_RELATED_ARTIST_COUNT],
}

pub struct ArtistMapCtx {
    pub last_position: [f32; 3],
    pub artists_indices_by_id: HashMap<u32, usize>,
    pub all_artists: Vec<(u32, ArtistState)>,
    pub sorted_artist_ids: Vec<u32>,
    pub all_artist_relationships: Vec<ArtistRelationships>,
    pub total_rendered_label_count: usize,
    pub playing_music_artist_id: Option<u32>,
    pub most_recently_played_artist_ids: VecDeque<u32>,
    pub connections_buffer: Vec<[[f32; 3]; 2]>,
    pub rendered_connections: HashSet<(usize, usize)>,
    pub did_set_highlighted_artists: bool,
    pub last_force_labeled_artist_id: Option<u32>,
    pub is_mobile: bool,
    pub quality: u8,
    pub manual_play_artist_id: Option<u32>,
    pub received_chunks: HashSet<(u32, u32)>,
    pub color_noise: noise::SuperSimplex,
    pub connection_colors_buffer: Vec<u8>,
    pub artist_colors_buffer: Vec<(u32, [f32; 3])>,
}

const DISTANCE_MULTIPLIER: [f32; 3] = [50500., 50400., 54130.];
const LABEL_RENDER_DISTANCE: f32 = 16320.;
const MAX_MUSIC_PLAY_DISTANCE: f32 = 13740.;
const MAX_RECENTLY_PLAYED_ARTISTS_TO_TRACK: usize = 12;
const MAX_RELATED_ARTIST_COUNT: usize = 20;
const MAX_EXTRA_RANDOM_HIGHLIGHTED_ARTIST_ORBIT_MODE_LABEL_COUNT: usize = 12;
const DEFAULT_QUALITY: u8 = 7;
/// IDS of artists to be rendered when in orbit control mode.  Represent a wide variety of different
/// artists from disparate parts of the galaxy.
const ORBIT_LABEL_ARTIST_IDS: &[u32] = &[
    14710,   // The Beatles
    109666,  // The Living Tombstone
    486,     // Taylor Swift
    108584,  // Flux Pavilion
    779,     // BTS
    4394417, // Florida Georgia Line
    5538103, // Kidz Bop Kids
    1415410, // Bad Bunny
    54,      // Joji
    635,     // 21 Savage
    // 6822165,  // Sfera Ebbasta
    1121203,  // Livetune
    35177268, // Joe Rogan
    88531684, // LO-FI BEATS
    895,      // 100 Gecs
    112965,   // London Symphony Orchestra
    358,      // Metallica
    583,      // Slayer
    929988,   // Bob Marley & The Wailers
    // 88522605, // FrivolousFox ASMR
    470, // $uicideboy$
    8,   // Flume
    // 171, // Kero Kero Bonito
    105,    // Avicii
    10072,  // The Red Hot Chili Peppers
    110546, // Vektroid
    111155, // Elvis Presley
    473,    // Eminem
];

impl Default for ArtistMapCtx {
    fn default() -> Self {
        ArtistMapCtx {
            last_position: [f32::INFINITY, f32::INFINITY, f32::INFINITY],
            artists_indices_by_id: HashMap::default(),
            all_artists: Vec::new(),
            sorted_artist_ids: Vec::new(),
            all_artist_relationships: Vec::new(),
            total_rendered_label_count: 0,
            playing_music_artist_id: None,
            most_recently_played_artist_ids: VecDeque::new(),
            connections_buffer: Vec::new(),
            rendered_connections: HashSet::default(),
            did_set_highlighted_artists: false,
            last_force_labeled_artist_id: None,
            is_mobile: false,
            quality: DEFAULT_QUALITY,
            manual_play_artist_id: None,
            received_chunks: HashSet::default(),
            color_noise: noise::SuperSimplex::new().set_seed(COLOR_NOISE_SEED),
            connection_colors_buffer: Vec::new(),
            artist_colors_buffer: Vec::new(),
        }
    }
}

impl ArtistMapCtx {
    pub fn get_next_artist_to_play(&self, cur_x: f32, cur_y: f32, cur_z: f32) -> Option<u32> {
        let cur_position = [cur_x, cur_y, cur_z];

        self.all_artists
            .iter()
            .filter_map(|(id, state)| {
                if self.most_recently_played_artist_ids.contains(id) {
                    None
                } else {
                    let dist = distance(&state.position, &cur_position);
                    if dist > MAX_MUSIC_PLAY_DISTANCE {
                        None
                    } else {
                        Some((*id, FloatOrd(dist)))
                    }
                }
            })
            .min_by_key(|(_id, distance)| *distance)
            .map(|(id, _)| id)
    }

    pub fn start_playing_artist_id(&mut self, draw_commands: &mut Vec<u32>, artist_id: u32) {
        debug!("Starting music for artist id={}", artist_id);
        draw_commands.push(START_PLAYING_MUSIC_CMD);
        draw_commands.push(artist_id);
        self.playing_music_artist_id = Some(artist_id);
        self.manual_play_artist_id = None;

        let artist_ix = self.artists_indices_by_id.get(&artist_id).unwrap();
        let artist_state = &mut self.all_artists[*artist_ix].1;

        if !artist_state
            .render_state
            .contains(ArtistRenderState::HAS_NAME)
        {
            draw_commands.push(FETCH_ARTIST_DATA_CMD);
            draw_commands.push(artist_id);
        }
    }

    pub fn maybe_start_playing_new_music(
        &mut self,
        draw_commands: &mut Vec<u32>,
        cur_x: f32,
        cur_y: f32,
        cur_z: f32,
    ) {
        let next_artist_to_play = self.get_next_artist_to_play(cur_x, cur_y, cur_z);
        if let Some(next_artist_to_play) = next_artist_to_play {
            self.start_playing_artist_id(draw_commands, next_artist_to_play);
        } else {
            self.playing_music_artist_id = None;
        }
    }

    pub fn stop_playing_music(
        &mut self,
        artist_id: u32,
        draw_commands: &mut Vec<u32>,
        cur_x: f32,
        cur_y: f32,
        cur_z: f32,
        force_do_not_record_as_recently_played: bool,
    ) {
        draw_commands.push(STOP_PLAYING_MUSIC_CMD);
        draw_commands.push(artist_id);

        if !force_do_not_record_as_recently_played {
            self.most_recently_played_artist_ids.push_front(artist_id);
        }

        if self.most_recently_played_artist_ids.len() > MAX_RECENTLY_PLAYED_ARTISTS_TO_TRACK {
            self.most_recently_played_artist_ids.pop_back();
        }

        if cur_x.is_finite() {
            self.maybe_start_playing_new_music(draw_commands, cur_x, cur_y, cur_z);
        }
    }

    #[inline(never)]
    pub fn update_connections_buffer(&mut self, chunk_size: u32, chunk_ix: u32) {
        let new_artist_ids = self
            .sorted_artist_ids
            .chunks(chunk_size as usize)
            .skip(chunk_ix as usize)
            .next()
            .unwrap_or_default();

        let quality_rng_adjustment = get_connection_render_quality_rng_adjustment(self.quality);

        for artist_id in new_artist_ids {
            let src_artist_ix = *self.artists_indices_by_id.get(artist_id).unwrap();
            let src = &self.all_artists[src_artist_ix].1;
            let relationship_state = &mut self.all_artist_relationships[src_artist_ix];

            if relationship_state.related_artist_indices[0]
                .connections_buffer_index
                .is_some()
            {
                warn!(
                    "Double-received relationship data for artist_id={}",
                    artist_id
                );
                continue;
            }

            for relationship in
                &mut relationship_state.related_artist_indices[..relationship_state.count]
            {
                let related_artist_ix = relationship.related_artist_index;
                let dst = &self.all_artists[related_artist_ix].1;

                let should_render = should_render_connection(quality_rng_adjustment, &src, &dst);
                if !should_render {
                    continue;
                }

                // Skip rendering connection if one already exists from the other direction
                let connection_key = (
                    src_artist_ix.min(related_artist_ix),
                    src_artist_ix.max(related_artist_ix),
                );
                if !self.rendered_connections.insert(connection_key) {
                    continue;
                }

                self.connections_buffer.push([src.position, dst.position]);
                relationship.connections_buffer_index = Some(self.connections_buffer.len() - 1);
            }
        }
    }

    pub fn add_highlighted_artist_orbit_labels(&mut self, draw_commands: &mut Vec<u32>) {
        let mut rendered_label_positions: Vec<[f32; 3]> = ORBIT_LABEL_ARTIST_IDS
            .iter()
            .map(|id| {
                let artist_ix = self.artists_indices_by_id.get(id).unwrap();
                self.all_artists[*artist_ix].1.position
            })
            .collect();

        let all_highlighted_artists: Vec<(u32, [f32; 3])> = self
            .all_artists
            .iter()
            .filter_map(|(id, state)| {
                if state
                    .render_state
                    .contains(ArtistRenderState::IS_HIGHLIGHTED)
                {
                    Some((*id, state.position))
                } else {
                    None
                }
            })
            .collect();

        // Find up to 7 of the highlighted artists that have the highest min distance to any of the
        // always-rendered orbit labels
        for _ in 0..7 {
            let highlighted_artist_with_largest_min_distance_to_existing_label: Option<(u32, f32)> =
                all_highlighted_artists
                    .iter()
                    .map(|(id, position)| {
                        let min_distance = rendered_label_positions
                            .iter()
                            .map(|label_position| FloatOrd(distance(position, label_position)))
                            .min()
                            .unwrap()
                            .0;
                        (*id, min_distance)
                    })
                    .max_by_key(|(_id, min_distance)| FloatOrd(*min_distance));

            let (artist_id, min_distance_to_existing_label) =
                match highlighted_artist_with_largest_min_distance_to_existing_label {
                    Some(val) => val,
                    None => return,
                };

            if min_distance_to_existing_label <= 10_000. {
                info!(
                    "Custom label min distance to existing label is too small; not rendering any \
                     more custom labels",
                );
                // If min distance is very small, don't place any more
                return;
            }

            let artist_ix = self.artists_indices_by_id.get(&artist_id).unwrap();
            let artist_state = &mut self.all_artists[*artist_ix].1;
            artist_state
                .render_state
                .set(ArtistRenderState::RENDER_LABEL, true);
            draw_commands.push(FETCH_ARTIST_DATA_CMD);
            draw_commands.push(artist_id);

            // Take this label into account when picking others to render as well
            rendered_label_positions.push(artist_state.position);
        }

        // Also render up to `MAX_EXTRA_RANDOM_HIGHLIGHTED_ARTIST_ORBIT_MODE_LABEL_COUNT` additional
        // random artists that are further than the min distance threshold from any of the
        // always-rendered orbit labels
        let mut rendered_random_artist_count = 0usize;
        for _ in 0..100 {
            if rendered_random_artist_count
                >= MAX_EXTRA_RANDOM_HIGHLIGHTED_ARTIST_ORBIT_MODE_LABEL_COUNT
            {
                info!(
                    "Rendered {} extra random artists!",
                    MAX_EXTRA_RANDOM_HIGHLIGHTED_ARTIST_ORBIT_MODE_LABEL_COUNT
                );
                return;
            }

            let (random_artist_id, position) = all_highlighted_artists.choose(rng()).unwrap();
            let min_distance = rendered_label_positions
                .iter()
                .map(|label_position| FloatOrd(distance(position, label_position)))
                .min()
                .unwrap()
                .0;

            if min_distance <= 26_200. {
                continue;
            }

            let artist_ix = self.artists_indices_by_id.get(&random_artist_id).unwrap();
            let artist_state = &mut self.all_artists[*artist_ix].1;
            artist_state
                .render_state
                .set(ArtistRenderState::RENDER_LABEL, true);
            draw_commands.push(FETCH_ARTIST_DATA_CMD);
            draw_commands.push(*random_artist_id);

            // Take this label into account when picking others to render as well
            rendered_label_positions.push(artist_state.position);
            rendered_random_artist_count += 1;
        }

        info!(
            "Ran out of attempts rendering extra random artists, rendered_random_artist_count={}",
            rendered_random_artist_count
        );
    }
}

const DID_INIT: Once = Once::new();

fn maybe_init() {
    DID_INIT.call_once(|| {
        if cfg!(debug_assertions) {
            console_error_panic_hook::set_once();
            wasm_logger::init(wasm_logger::Config::default());
        }

        let seed: u64 = unsafe { std::mem::transmute(js_random()) };
        unsafe {
            RNG = Box::into_raw(Box::new(pcg::Pcg::from_seed(seed.into())));
        }
    })
}

pub fn should_render_label(
    total_rendered_label_count: usize,
    artist_state: &ArtistState,
    distance: f32,
    is_mobile: bool,
    quality: u8,
) -> bool {
    if distance < 6800. {
        return true;
    }

    let mut score = distance;

    // Higher popularity artists show up further away
    score -= (artist_state.popularity as f32).powi(2) * 1.9;

    // If we're in a very dense area with many labels rendered, make it harder to render more
    score += fastapprox::faster::pow(
        total_rendered_label_count as f32,
        if is_mobile { 1.33 } else { 1.14 },
    ) * 22.2;

    if artist_state
        .render_state
        .contains(ArtistRenderState::IS_HIGHLIGHTED)
    {
        score *= 0.3338
    }

    if is_mobile {
        score *= 1.1347;
    }

    let mut quality_diff = DEFAULT_QUALITY as i8 - quality as i8;
    while quality_diff > 0 {
        score *= 0.95;
        quality_diff -= 1;
    }
    while quality_diff > 0 {
        score *= 1.087;
        quality_diff += 1;
    }

    score <= LABEL_RENDER_DISTANCE
}

#[wasm_bindgen]
pub fn create_artist_map_ctx() -> *mut ArtistMapCtx {
    maybe_init();

    Box::into_raw(Box::new(ArtistMapCtx::default()))
}

/// Returns total number of artists in the embedding
#[wasm_bindgen]
pub fn decode_and_record_packed_artist_positions(
    ctx: *mut ArtistMapCtx,
    packed: Vec<u8>,
    is_mobile: bool,
) -> usize {
    let ctx = unsafe { &mut *ctx };

    let ptr = packed.as_ptr() as *const u32;
    let count = unsafe { *ptr } as usize;

    ctx.all_artists.reserve(count);
    ctx.all_artist_relationships.reserve(count);
    ctx.sorted_artist_ids.reserve(count);
    ctx.artists_indices_by_id.reserve(count);
    ctx.is_mobile = is_mobile;

    let mut maxs = [f32::NEG_INFINITY; 3];
    let mut mins = [f32::INFINITY; 3];

    let has_popularities = packed.len() > 4 + count * 4 + count * 3 * 4;
    let popularities_byte_offset = 4 + count * 4 + count * 3 * 4;
    let popularities_ptr = unsafe { (ptr as *const u8).add(popularities_byte_offset) };

    let ptr = unsafe { ptr.add(1) };
    for i in 0..count {
        unsafe {
            let id: u32 = *ptr.add(i);
            let pos: &[f32; 3] = &*(ptr.add(count + i * 3) as *const _);
            let mut pos: [f32; 3] = *pos;
            for (dim_ix, val) in pos.iter_mut().enumerate() {
                *val *= DISTANCE_MULTIPLIER[dim_ix];
            }

            for (dim_ix, val) in pos.iter().enumerate() {
                maxs[dim_ix] = maxs[dim_ix].max(*val);
                mins[dim_ix] = mins[dim_ix].min(*val);
            }

            let state = ArtistState {
                position: pos.clone(),
                popularity: if has_popularities {
                    *popularities_ptr.add(i)
                } else {
                    20
                },
                render_state: ArtistRenderState::empty(),
            };
            ctx.all_artists.push((id, state));
            ctx.all_artist_relationships.push(Default::default());
            ctx.sorted_artist_ids.push(id);

            ctx.artists_indices_by_id
                .insert(id, ctx.all_artists.len() - 1);
        }
    }

    ctx.sorted_artist_ids.sort_unstable();

    info!("Successfully parsed + stored {} artist positions", count);

    ctx.populate_artist_color_buffer();

    count
}

#[wasm_bindgen]
pub fn get_all_artist_data(ctx: *mut ArtistMapCtx) -> Vec<f32> {
    let ctx = unsafe { &mut *ctx };

    let mut out: Vec<f32> = Vec::with_capacity(ctx.all_artists.len() * 5);
    unsafe { out.set_len(ctx.all_artists.len() * 5) };

    for (i, (artist_id, state)) in ctx.all_artists.iter().enumerate() {
        out[i * 5] = unsafe { std::mem::transmute(*artist_id) };

        for (dim_ix, val_for_dim) in state.position.iter().enumerate() {
            out[i * 5 + 1 + dim_ix] = *val_for_dim;
        }

        out[i * 5 + 4] = unsafe { std::mem::transmute(state.popularity as u32) };
    }

    out
}

// TODO: SIMD-ify maybe idk
fn distance(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    let mut sum = 0.;
    for (a, b) in a.iter().zip(b.iter()) {
        sum += (a - b).powi(2);
    }
    sum.sqrt()
}

/// Returns a vector of draw commands
#[wasm_bindgen]
pub fn handle_received_artist_names(
    ctx: *mut ArtistMapCtx,
    artist_ids: Vec<u32>,
    cur_x: f32,
    cur_y: f32,
    cur_z: f32,
    is_fly_mode: bool,
) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };

    let mut draw_commands: Vec<u32> = Vec::new();

    for artist_id in artist_ids {
        let artist_state = match ctx.artists_indices_by_id.get(&artist_id) {
            Some(ix) => &mut ctx.all_artists[*ix].1,
            None => {
                error!(
                    "Artist not in embedding but received name for it; artist_id={}",
                    artist_id
                );
                continue;
            },
        };

        if artist_state
            .render_state
            .contains(ArtistRenderState::HAS_NAME)
        {
            warn!(
                "Received artist name multiple times for artist_id={}",
                artist_id
            );
            continue;
        }

        artist_state
            .render_state
            .set(ArtistRenderState::HAS_NAME, true);

        let distance = distance(&artist_state.position, &[cur_x, cur_y, cur_z]);
        if artist_state
            .render_state
            .contains(ArtistRenderState::RENDER_LABEL)
            && (!is_fly_mode
                || should_render_label(
                    ctx.total_rendered_label_count,
                    artist_state,
                    distance,
                    ctx.is_mobile,
                    ctx.quality,
                ))
        {
            ctx.total_rendered_label_count += 1;
            draw_commands.push(ADD_LABEL_CMD);
            draw_commands.push(artist_id);
        } else {
            artist_state
                .render_state
                .set(ArtistRenderState::RENDER_LABEL, false);
        }
    }

    draw_commands
}

fn should_render_artist(
    distance: f32,
    popularity: u8,
    render_state: &ArtistRenderState,
    is_mobile: bool,
    is_fly_mode: bool,
    quality: u8,
) -> bool {
    if distance < 9000. {
        return true;
    }

    if render_state.contains(ArtistRenderState::IS_HIGHLIGHTED) {
        return true;
    }

    let mut score = distance;
    score -= (popularity as f32).powi(3) * 0.1;

    if is_mobile {
        score *= 1.56;
    }

    let mut quality_diff = DEFAULT_QUALITY as i8 - quality as i8;
    while quality_diff > 0 {
        score *= if is_mobile { 1.2 } else { 1.34 };
        quality_diff -= 1;
    }
    while quality_diff < 0 {
        score *= if is_fly_mode { 0.808 } else { 0.72 };
        quality_diff += 1;
    }

    score < 36_800.
}

static mut RNG: *mut pcg::Pcg = std::ptr::null_mut();

fn rng() -> &'static mut pcg::Pcg { unsafe { &mut *RNG } }

fn get_connection_render_quality_rng_adjustment(quality: u8) -> f64 {
    let mut quality_rng_adjustment = -0.1;

    let mut quality_diff: i8 = DEFAULT_QUALITY as i8 - quality as i8;
    // If quality is lower than default (difference is positive), we decrease the bottom range of
    // generated random values for the score so that it's less likely at all distances that the
    // connection is rendered
    //
    // rng range goes from (0, 1) to something like (-0.2, 1).
    while quality_diff > 0 {
        quality_rng_adjustment -= 0.15;
        quality_diff -= 1;
    }
    // If quality is higher than default (difference is negative), we increase the bottom range of
    // generated random values for the score so that it's less likely at all distances that the
    // connection is rendered
    //
    // rng range goes from (0, 1) to something like (0.2, 1).
    while quality_diff < 0 {
        quality_rng_adjustment += 0.1;
        quality_diff += 1;
    }

    quality_rng_adjustment
}

fn should_render_connection(
    quality_rng_adjustment: f64,
    src: &ArtistState,
    dst: &ArtistState,
) -> bool {
    let val = rng().gen_range(quality_rng_adjustment, 1.0f64);
    let dist = distance(&src.position, &dst.position);

    if dist > 70000. {
        return false;
    } else if dist > 25000. {
        return val > 0.994;
    } else if dist > 17000. {
        return val > 0.82;
    } else if dist > 8000. {
        return val > 0.28;
    } else {
        return val > 0.185;
    }
}

const ADD_LABEL_CMD: u32 = 0u32;
const REMOVE_LABEL_CMD: u32 = 1u32;
const ADD_ARTIST_GEOMETRY_CMD: u32 = 2u32;
const REMOVE_ARTIST_GEOMETRY_CMD: u32 = 3u32;
const FETCH_ARTIST_DATA_CMD: u32 = 4u32;
const START_PLAYING_MUSIC_CMD: u32 = 5u32;
const STOP_PLAYING_MUSIC_CMD: u32 = 6u32;

/// Returns a vector of draw commands
#[wasm_bindgen]
pub fn handle_new_position(
    ctx: *mut ArtistMapCtx,
    cur_x: f32,
    cur_y: f32,
    cur_z: f32,
    projected_next_x: f32,
    projected_next_y: f32,
    projected_next_z: f32,
    is_fly_mode: bool,
) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };

    if ctx.last_position[0] == cur_x
        && ctx.last_position[1] == cur_y
        && ctx.last_position[2] == cur_z
    {
        return Vec::new();
    }
    ctx.last_position = [cur_x, cur_y, cur_z];

    // 0: label to add
    // 1: label to remove
    // 2: artist geometry to add
    // 3: artist geomety to remove
    // 4: fetch artist data
    // 5: start playing music, followed by artist ID
    // 6: stop playing music, followed by artist ID
    let mut render_commands: Vec<u32> = Vec::new();

    for (artist_id, artist_state) in ctx.all_artists.iter_mut() {
        let distance = distance(&artist_state.position, &ctx.last_position);

        let should_render_label = should_render_label(
            ctx.total_rendered_label_count,
            artist_state,
            distance,
            ctx.is_mobile,
            ctx.quality,
        );
        if should_render_label
            != artist_state
                .render_state
                .contains(ArtistRenderState::RENDER_LABEL)
            && is_fly_mode
        {
            artist_state
                .render_state
                .toggle(ArtistRenderState::RENDER_LABEL);

            if should_render_label {
                if artist_state
                    .render_state
                    .contains(ArtistRenderState::HAS_NAME)
                {
                    // Render artist label
                    render_commands.push(ADD_LABEL_CMD);
                    ctx.total_rendered_label_count += 1;
                } else {
                    // Fetch artist name
                    render_commands.push(FETCH_ARTIST_DATA_CMD);
                }
            } else {
                // Remove artist label
                render_commands.push(1);
                if ctx.total_rendered_label_count == 0 {
                    warn!(
                        "Total rendered label count accounting error; was zero and tried to \
                         subtract one when removing artist label"
                    );
                }
                ctx.total_rendered_label_count = ctx.total_rendered_label_count.saturating_sub(1);
            }
            render_commands.push(*artist_id);
        }

        let should_render_geometry = should_render_artist(
            distance,
            artist_state.popularity,
            &artist_state.render_state,
            ctx.is_mobile,
            is_fly_mode,
            ctx.quality,
        );
        if should_render_geometry
            != artist_state
                .render_state
                .contains(ArtistRenderState::RENDER_GEOMETRY)
        {
            if should_render_geometry {
                render_commands.push(2);
            } else {
                render_commands.push(3);
            }
            render_commands.push(*artist_id);

            artist_state
                .render_state
                .toggle(ArtistRenderState::RENDER_GEOMETRY);
        }
    }

    // If in fly mode, don't play any music
    if !is_fly_mode {
        return render_commands;
    }

    let projected_next_pos = [projected_next_x, projected_next_y, projected_next_z];
    match ctx.playing_music_artist_id {
        Some(artist_id) => {
            let was_manual_play = ctx.manual_play_artist_id == Some(artist_id);

            let artist_index = ctx.artists_indices_by_id.get(&artist_id).unwrap();
            let distance_to_listener = distance(
                &ctx.all_artists[*artist_index].1.position,
                &projected_next_pos,
            );
            let max_distance = if was_manual_play {
                MAX_MUSIC_PLAY_DISTANCE * 2.
            } else {
                MAX_MUSIC_PLAY_DISTANCE
            };

            if distance_to_listener > max_distance {
                debug!(
                    "Stopping music for artist_id={} due to movement out of range",
                    artist_id
                );
                ctx.stop_playing_music(
                    artist_id,
                    &mut render_commands,
                    projected_next_x,
                    projected_next_y,
                    projected_next_z,
                    false,
                );
            }
        },
        None => {
            ctx.maybe_start_playing_new_music(
                &mut render_commands,
                projected_next_x,
                projected_next_y,
                projected_next_z,
            );
        },
    }

    render_commands
}

/// Returns a vector of draw commands
#[wasm_bindgen]
pub fn on_music_finished_playing(
    ctx: *mut ArtistMapCtx,
    artist_id: u32,
    cur_x: f32,
    cur_y: f32,
    cur_z: f32,
) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };
    let mut draw_commands = Vec::new();

    debug!("Music finished playing for artist id={}", artist_id);

    if ctx.playing_music_artist_id != Some(artist_id) {
        return draw_commands;
    }

    ctx.stop_playing_music(artist_id, &mut draw_commands, cur_x, cur_y, cur_z, false);

    draw_commands
}

/// Returns connection buffer length
#[wasm_bindgen]
pub fn handle_artist_relationship_data(
    ctx: *mut ArtistMapCtx,
    packed_relationship_data: Vec<u8>,
    chunk_size: u32,
    chunk_ix: u32,
) -> usize {
    let ctx = unsafe { &mut *ctx };
    ctx.received_chunks.insert((chunk_ix, chunk_size));

    let artist_ids = ctx
        .sorted_artist_ids
        .chunks(chunk_size as usize)
        .skip(chunk_ix as usize)
        .next()
        .unwrap_or_default();
    let artist_ids_byte_offset = artist_ids.len() + 4 - (artist_ids.len() % 4);

    assert_eq!(packed_relationship_data.len() % 4, 0);
    let u32_view = unsafe {
        std::slice::from_raw_parts(
            packed_relationship_data
                .as_ptr()
                .add(artist_ids_byte_offset) as *const u32,
            (packed_relationship_data.len() - artist_ids_byte_offset) / 4,
        )
    };

    let mut offset = 0;
    for i in 0..artist_ids.len() {
        let artist_id = artist_ids[i];
        let artist_index = *ctx.artists_indices_by_id.get(&artist_id).unwrap();
        let relationship_state = &mut ctx.all_artist_relationships[artist_index];

        let count = packed_relationship_data[i] as usize;
        let mut actual_count = 0;
        for relationship_ix in 0..count {
            let related_artist_id = u32_view[offset + relationship_ix];
            let related_artist_index = match ctx.artists_indices_by_id.get(&related_artist_id) {
                Some(ix) => *ix,
                // It's possible the artist is related to one that's not in the embedding
                None => continue,
            };

            relationship_state.related_artist_indices[actual_count] = ArtistRelationship {
                related_artist_index,
                connections_buffer_index: None,
            };
            actual_count += 1;
        }
        relationship_state.count = actual_count;

        offset += count;
    }

    assert_eq!(
        artist_ids_byte_offset + offset * 4,
        packed_relationship_data.len()
    );
    ctx.update_connections_buffer(chunk_size, chunk_ix);
    ctx.populate_connection_colors_buffer();

    ctx.connections_buffer.len() * 6
}

#[wasm_bindgen]
pub fn get_connections_buffer_ptr(ctx: *mut ArtistMapCtx) -> *const f32 {
    let ctx = unsafe { &mut *ctx };
    ctx.connections_buffer.as_ptr() as *const f32
}

#[wasm_bindgen]
pub fn get_connections_buffer_length(ctx: *mut ArtistMapCtx) -> usize {
    let ctx = unsafe { &mut *ctx };
    ctx.connections_buffer.len() * 6
}

#[wasm_bindgen]
pub fn get_connections_color_buffer_ptr(ctx: *mut ArtistMapCtx) -> *const f32 {
    let ctx = unsafe { &mut *ctx };
    ctx.connection_colors_buffer.as_ptr() as *const f32
}

#[wasm_bindgen]
pub fn get_connections_color_buffer_length(ctx: *mut ArtistMapCtx) -> usize {
    let ctx = unsafe { &mut *ctx };
    ctx.connection_colors_buffer.len()
}

#[wasm_bindgen]
pub fn get_artist_colors_buffer_ptr(ctx: *mut ArtistMapCtx) -> *const f32 {
    let ctx = unsafe { &mut *ctx };
    ctx.artist_colors_buffer.as_ptr() as *const f32
}

#[wasm_bindgen]
pub fn get_artist_colors_buffer_length(ctx: *mut ArtistMapCtx) -> usize {
    let ctx = unsafe { &mut *ctx };
    ctx.artist_colors_buffer.len() * 4
}

#[wasm_bindgen]
pub fn get_memory() -> JsValue { wasm_bindgen::memory() }

/// Returns a list of draw commands to execute
#[wasm_bindgen]
pub fn handle_set_highlighted_artists(
    ctx: *mut ArtistMapCtx,
    highlighted_artist_ids: Vec<u32>,
    cur_x: f32,
    cur_y: f32,
    cur_z: f32,
    is_fly_mode: bool,
) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };
    let cur_pos = [cur_x, cur_y, cur_z];

    let mut draw_commands = Vec::new();

    // First, un-mark all artists as highlighted.  If they should no longer be rendered, dispatch
    // draw commands to remove them.
    for (artist_id, state) in ctx.all_artists.iter_mut() {
        let was_highlighted = state
            .render_state
            .contains(ArtistRenderState::IS_HIGHLIGHTED);
        if !was_highlighted {
            continue;
        }

        state.render_state.toggle(ArtistRenderState::IS_HIGHLIGHTED);
        let distance_to_artist = distance(&state.position, &cur_pos);
        let should_render = should_render_artist(
            distance_to_artist,
            state.popularity,
            &state.render_state,
            ctx.is_mobile,
            is_fly_mode,
            ctx.quality,
        );
        if should_render {
            draw_commands.push(ADD_ARTIST_GEOMETRY_CMD);
            draw_commands.push(*artist_id);
        } else {
            draw_commands.push(REMOVE_ARTIST_GEOMETRY_CMD);
            draw_commands.push(*artist_id);
        }
    }

    for highlighted_artist_id in highlighted_artist_ids {
        let artist_index = match ctx.artists_indices_by_id.get(&highlighted_artist_id) {
            Some(&id) => id,
            None => continue,
        };
        let (_, state) = &mut ctx.all_artists[artist_index];
        state
            .render_state
            .set(ArtistRenderState::IS_HIGHLIGHTED, true);
        draw_commands.push(ADD_ARTIST_GEOMETRY_CMD);
        draw_commands.push(highlighted_artist_id);
    }

    if !is_fly_mode {
        info!("Highlighted artists set and is not fly mode; adding custom labels...");
        ctx.add_highlighted_artist_orbit_labels(&mut draw_commands);
    }
    ctx.did_set_highlighted_artists = true;

    draw_commands
}

/// Returns a list of draw commands to execute
#[wasm_bindgen]
pub fn handle_artist_manual_play(ctx: *mut ArtistMapCtx, artist_id: u32) -> Vec<u32> {
    info!("Handling manual play for artist_id={}", artist_id);
    let ctx = unsafe { &mut *ctx };

    let mut draw_commands = Vec::new();

    if let Some(playing_artist_id) = ctx.playing_music_artist_id {
        if playing_artist_id == artist_id {
            return draw_commands;
        }

        ctx.stop_playing_music(
            playing_artist_id,
            &mut draw_commands,
            std::f32::NEG_INFINITY,
            std::f32::NEG_INFINITY,
            std::f32::NEG_INFINITY,
            true,
        );
    }

    ctx.start_playing_artist_id(&mut draw_commands, artist_id);
    ctx.manual_play_artist_id = Some(artist_id);

    draw_commands
}

/// Returns a list of draw commands to execute
#[wasm_bindgen]
pub fn play_last_artist(ctx: *mut ArtistMapCtx) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };

    let last_played_artist_id = match ctx.most_recently_played_artist_ids.pop_front() {
        Some(id) => id,
        None => {
            info!("No last played artist; not playing last played artist");
            return Vec::new();
        },
    };

    info!("Playing last played artist_id={}", last_played_artist_id);

    handle_artist_manual_play(ctx, last_played_artist_id)
}

#[wasm_bindgen]
pub fn get_connections_for_artists(
    ctx: *mut ArtistMapCtx,
    artist_ids: Vec<u32>,
    constrain_destinations_to_set: bool,
) -> Vec<f32> {
    let ctx = unsafe { &mut *ctx };

    let mut all_connections: HashSet<(u32, u32)> = HashSet::default();
    let mut points: Vec<f32> = Vec::new();

    fn sort_pair(pair: (u32, u32)) -> (u32, u32) {
        if pair.0 < pair.1 {
            pair
        } else {
            (pair.1, pair.0)
        }
    }

    for &artist_id in &artist_ids {
        let artist_index = match ctx.artists_indices_by_id.get(&artist_id) {
            Some(ix) => *ix,
            None => continue,
        };
        let state = &ctx.all_artist_relationships[artist_index];
        for relationship in &state.related_artist_indices[..state.count] {
            let related_artist_id = ctx.all_artists[relationship.related_artist_index].0;
            let related_artist_position = &ctx.all_artists[relationship.related_artist_index]
                .1
                .position;
            if artist_id == related_artist_id {
                continue;
            }

            let pair = if constrain_destinations_to_set {
                if !artist_ids.contains(&related_artist_id) {
                    continue;
                }

                (artist_id, related_artist_id)
            } else {
                if artist_ids.contains(&related_artist_id) {
                    continue;
                }

                (artist_id, related_artist_id)
            };
            let pair = sort_pair(pair);
            if !all_connections.contains(&pair) {
                all_connections.insert(pair);

                let pos_0 = &ctx.all_artists[artist_index].1.position;
                let pos_1 = related_artist_position;

                points.extend_from_slice(pos_0);
                points.extend_from_slice(pos_1);
            }
        }
    }

    points
}

#[wasm_bindgen]
pub fn transition_to_orbit_mode(ctx: *mut ArtistMapCtx) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };
    ctx.last_force_labeled_artist_id = None;

    let mut draw_commands = Vec::new();

    if let Some(playing_artist_id) = ctx.playing_music_artist_id {
        ctx.stop_playing_music(
            playing_artist_id,
            &mut draw_commands,
            std::f32::NEG_INFINITY,
            std::f32::NEG_INFINITY,
            std::f32::NEG_INFINITY,
            true,
        );
    }
    ctx.most_recently_played_artist_ids.clear();

    for (id, state) in ctx.all_artists.iter_mut() {
        if state.render_state.contains(ArtistRenderState::RENDER_LABEL) {
            state.render_state.remove(ArtistRenderState::RENDER_LABEL);
            draw_commands.push(REMOVE_LABEL_CMD);
            draw_commands.push(*id);
        }
    }

    // Render the special orbit-mode labels
    for artist_id in ORBIT_LABEL_ARTIST_IDS {
        let artist_index = match ctx.artists_indices_by_id.get(artist_id) {
            Some(&id) => id,
            None => continue,
        };
        let (_, state) = &mut ctx.all_artists[artist_index];

        state
            .render_state
            .set(ArtistRenderState::RENDER_LABEL, true);
        if state.render_state.contains(ArtistRenderState::HAS_NAME) {
            draw_commands.push(ADD_LABEL_CMD);
        } else {
            draw_commands.push(FETCH_ARTIST_DATA_CMD);
        }
        draw_commands.push(*artist_id);
    }

    if ctx.did_set_highlighted_artists {
        info!("Transitioned to orbit mode and highlighted artists set; adding in extra labels...");
        ctx.add_highlighted_artist_orbit_labels(&mut draw_commands);
    }

    draw_commands
}

#[wasm_bindgen]
pub fn force_render_artist_label(ctx: *mut ArtistMapCtx, artist_id: u32) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };

    let mut draw_commands = Vec::new();

    if let Some(last_force_rendered_artist_id) = ctx.last_force_labeled_artist_id {
        info!(
            "De-rendering last force-rendered artist id={}",
            last_force_rendered_artist_id
        );
        let last_force_rendered_artist_index = match ctx
            .artists_indices_by_id
            .get(&last_force_rendered_artist_id)
        {
            Some(ix) => *ix,
            None => return draw_commands,
        };
        let (_, state) = &mut ctx.all_artists[last_force_rendered_artist_index];
        state
            .render_state
            .set(ArtistRenderState::RENDER_LABEL, false);
        draw_commands.push(REMOVE_LABEL_CMD);
        draw_commands.push(last_force_rendered_artist_id);
    } else {
        info!("No last force-rendered artist id; not de-rendering");
    }

    let artist_index = match ctx.artists_indices_by_id.get(&artist_id) {
        Some(ix) => *ix,
        None => return draw_commands,
    };
    let (_, state) = &mut ctx.all_artists[artist_index];

    // If the label is already rendered, do nothing
    if state.render_state.contains(ArtistRenderState::RENDER_LABEL) {
        info!("Force-rendering already rendered artist label; doing nothing.");
        ctx.last_force_labeled_artist_id = None;
        return draw_commands;
    } else {
        info!(
            "Artist label not currently rendered; setting `last_force_labeled_artist_id` to {}",
            artist_id
        );
        ctx.last_force_labeled_artist_id = Some(artist_id);
    }

    state
        .render_state
        .set(ArtistRenderState::RENDER_LABEL, true);
    draw_commands.push(
        if state.render_state.contains(ArtistRenderState::HAS_NAME) {
            ADD_LABEL_CMD
        } else {
            FETCH_ARTIST_DATA_CMD
        },
    );
    draw_commands.push(artist_id);

    draw_commands
}

#[wasm_bindgen]
pub fn set_quality(ctx: *mut ArtistMapCtx, new_quality: u8) {
    let ctx = unsafe { &mut *ctx };
    ctx.quality = new_quality;

    if new_quality > DEFAULT_QUALITY {
        info!("Not updating connections buffer because new quality is greater than default");
        return;
    }

    // Re-build connections geometry to take into account new quality
    info!(
        "Set quality to {}; building new connections data buffer...",
        new_quality
    );
    for relationships in &mut ctx.all_artist_relationships {
        for relationship in &mut relationships.related_artist_indices {
            relationship.connections_buffer_index = None;
        }
    }
    ctx.connections_buffer.clear();
    ctx.rendered_connections.clear();

    info!(
        "Updating connections buffer with connections from {} chunks: {:?}",
        ctx.received_chunks.len(),
        ctx.received_chunks
    );

    let mut chunks_to_rerender = ctx.received_chunks.iter().cloned().collect::<Vec<_>>();
    chunks_to_rerender.sort_unstable();

    for (chunk_ix, chunk_size) in chunks_to_rerender {
        ctx.update_connections_buffer(chunk_size, chunk_ix);
    }
    ctx.populate_connection_colors_buffer();
}
