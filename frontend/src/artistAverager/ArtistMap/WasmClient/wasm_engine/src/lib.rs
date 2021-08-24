#![feature(box_syntax, new_uninit)]
#![allow(invalid_value)]

#[macro_use]
extern crate log;

use std::{
    collections::{HashMap, VecDeque},
    sync::Once,
};

use bitflags::bitflags;
use float_ord::FloatOrd;
use partitioning::{IteredPartition, PartitionedUniverse};
use wasm_bindgen::prelude::*;

use crate::partitioning::{create_partitions, InRange};

mod partitioning;

bitflags! {
    pub struct ArtistRenderState: u8 {
        const RENDER_LABEL = 0b0000_0001;
        const RENDER_CONNECTIONS = 0b0000_0010;
        /// Should actually render the artist
        const RENDER_GEOMETRY = 0b0000_0100;
        /// Name has been received from spotify and we can actually render it
        const HAS_NAME = 0b0000_1000;
        /// Artist's music has recently been played
        const HAS_RECENTLY_PLAYED = 0b0001_0000;
    }
}

#[derive(Clone)]
pub struct ArtistState {
    pub position: [f32; 3],
    pub popularity: u8,
    pub render_state: ArtistRenderState,
}

pub struct ArtistMapCtx {
    pub last_position: [f32; 3],
    pub artists_indices_by_id: HashMap<u32, usize>,
    pub all_artists: Vec<(u32, ArtistState)>,
    pub partitions: PartitionedUniverse,
    pub total_rendered_label_count: usize,
    pub playing_music_artist_id: Option<u32>,
    pub most_recently_played_artist_ids: VecDeque<u32>,
}

const DISTANCE_MULTIPLIER: [f32; 3] = [18430., 18430., 22430.];
const LABEL_RENDER_DISTANCE: f32 = 8320.;
const MAX_MUSIC_PLAY_DISTANCE: f32 = 4_000.;
const MAX_RECENTLY_PLAYED_ARTISTS_TO_TRACK: usize = 32;

impl Default for ArtistMapCtx {
    fn default() -> Self {
        ArtistMapCtx {
            last_position: [f32::INFINITY, f32::INFINITY, f32::INFINITY],
            artists_indices_by_id: HashMap::new(),
            all_artists: Vec::new(),
            partitions: unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            total_rendered_label_count: 0,
            playing_music_artist_id: None,
            most_recently_played_artist_ids: VecDeque::new(),
        }
    }
}

impl ArtistMapCtx {
    // TODO: Take movement direction into account
    pub fn get_next_artist_to_play(&self, cur_x: f32, cur_y: f32, cur_z: f32) -> Option<u32> {
        let cur_position = [cur_x, cur_y, cur_z];

        // TODO: Make this better
        self.all_artists
            .iter()
            .filter_map(|(id, state)| {
                if state
                    .render_state
                    .contains(ArtistRenderState::HAS_RECENTLY_PLAYED)
                {
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

    pub fn maybe_start_playing_new_music(
        &mut self,
        draw_commands: &mut Vec<u32>,
        cur_x: f32,
        cur_y: f32,
        cur_z: f32,
    ) {
        let next_artist_to_play = self.get_next_artist_to_play(cur_x, cur_y, cur_z);
        if let Some(next_artist_to_play) = next_artist_to_play {
            debug!("Starting music for artist id={}", next_artist_to_play);
            draw_commands.push(5);
            draw_commands.push(next_artist_to_play);
            self.playing_music_artist_id = Some(next_artist_to_play);

            let artist_ix = self
                .artists_indices_by_id
                .get(&next_artist_to_play)
                .unwrap();
            let artist_state = &mut self.all_artists[*artist_ix].1;
            artist_state
                .render_state
                .set(ArtistRenderState::HAS_RECENTLY_PLAYED, true);
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
    ) {
        draw_commands.push(6);
        draw_commands.push(artist_id);
        self.most_recently_played_artist_ids.push_front(artist_id);

        if self.most_recently_played_artist_ids.len() > MAX_RECENTLY_PLAYED_ARTISTS_TO_TRACK {
            let artist_id = self.most_recently_played_artist_ids.pop_back().unwrap();
            let artist_ix = self.artists_indices_by_id.get(&artist_id).unwrap();
            self.all_artists[*artist_ix]
                .1
                .render_state
                .set(ArtistRenderState::HAS_RECENTLY_PLAYED, false);
        }

        self.maybe_start_playing_new_music(draw_commands, cur_x, cur_y, cur_z);
    }
}

const DID_INIT: Once = Once::new();

fn maybe_init() {
    DID_INIT.call_once(|| {
        if cfg!(debug_assertions) {
            console_error_panic_hook::set_once();
            wasm_logger::init(wasm_logger::Config::default());
        }
    })
}

pub fn should_render_label(
    total_rendered_label_count: usize,
    artist_state: &ArtistState,
    distance: f32,
) -> bool {
    if distance < 1000. {
        return true;
    }

    let mut score = distance;

    // Higher popularity artists show up further away
    score -= (artist_state.popularity as f32).powi(2) * 2.2;

    // If we're in a very dense area with many labels rendered, make it harder to render more
    score += (total_rendered_label_count as f32).powf(1.3) * 20.2;

    score <= LABEL_RENDER_DISTANCE
}

#[wasm_bindgen]
pub fn create_artist_map_ctx() -> *mut ArtistMapCtx {
    maybe_init();

    Box::into_raw(box ArtistMapCtx::default())
}

/// Returns total number of artists in the embedding
#[wasm_bindgen]
pub fn decode_and_record_packed_artist_positions(ctx: *mut ArtistMapCtx, packed: Vec<u8>) -> usize {
    let ctx = unsafe { &mut *ctx };

    let ptr = packed.as_ptr() as *const u32;
    let count = unsafe { *ptr } as usize;

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

            ctx.artists_indices_by_id
                .insert(id, ctx.all_artists.len() - 1);
        }
    }

    let partitions = create_partitions(mins, maxs, &ctx.all_artists);
    // We didn't initialize the partitions when creating the context, so don't run destructors when
    // we set it now
    unsafe { std::ptr::write((&mut ctx.partitions) as *mut _, partitions) };

    info!("Successfully parsed + stored {} artist positions", count);
    count
}

// #[wasm_bindgen]
// pub fn get_artist_positions(ctx: *mut ArtistMapCtx, artist_ids: Vec<u32>) -> Vec<f32> {
//     let ctx = unsafe { &mut *ctx };

//     let mut out = Vec::with_capacity(3 * artist_ids.len());
//     unsafe { out.set_len(3 * artist_ids.len()) };

//     for (artist_ix, artist_id) in artist_ids.into_iter().enumerate() {
//         let pos = ctx
//             .artists_positions_by_id
//             .get(&artist_id)
//             .unwrap_or_else(|| {
//                 // error!(
//                 //     "Artist id not in embedding: {}, using 0,0,0 position",
//                 //     artist_id
//                 // );
//                 &MISSING_POS
//             });

//         for (dim_ix, val_for_dim) in pos.iter().enumerate() {
//             out[artist_ix * 3 + dim_ix] = *val_for_dim;
//         }
//     }

//     out
// }

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
            && should_render_label(ctx.total_rendered_label_count, artist_state, distance)
        {
            ctx.total_rendered_label_count += 1;
            draw_commands.push(0);
            draw_commands.push(artist_id);
        } else {
            artist_state
                .render_state
                .set(ArtistRenderState::RENDER_LABEL, false);
        }
    }

    draw_commands
}

// TODO: Lookup table by popularity
fn should_render_artist(distance: f32, popularity: u8) -> bool {
    if popularity >= 85 {
        return true;
    }

    if distance < 1000. {
        return true;
    }

    let mut score = distance;
    score -= (popularity as f32).powf(2.8) * 0.12;

    score < 1000.
}

/// Returns a vector of draw commands
#[wasm_bindgen]
pub fn handle_new_position(ctx: *mut ArtistMapCtx, cur_x: f32, cur_y: f32, cur_z: f32) -> Vec<u32> {
    let ctx = unsafe { &mut *ctx };

    if ctx.last_position[0] == cur_x
        && ctx.last_position[1] == cur_y
        && ctx.last_position[2] == cur_z
    {
        return Vec::new();
    }
    let delta_distance = distance(&ctx.last_position, &[cur_x, cur_y, cur_z]);
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

        let should_render_label =
            should_render_label(ctx.total_rendered_label_count, artist_state, distance);
        if should_render_label
            != artist_state
                .render_state
                .contains(ArtistRenderState::RENDER_LABEL)
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
                    render_commands.push(0);
                    ctx.total_rendered_label_count += 1;
                } else {
                    // Fetch artist name
                    render_commands.push(4);
                }
            } else {
                // Remove artist label
                render_commands.push(1);
                ctx.total_rendered_label_count -= 1;
            }
            render_commands.push(*artist_id);
        }

        let should_render_geometry = should_render_artist(distance, artist_state.popularity);
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

    match ctx.playing_music_artist_id {
        Some(artist_id) => {
            let artist_index = ctx.artists_indices_by_id.get(&artist_id).unwrap();
            if distance(
                &ctx.all_artists[*artist_index].1.position,
                &ctx.last_position,
            ) > MAX_MUSIC_PLAY_DISTANCE
            {
                debug!(
                    "Stopping music for artist_id={} due to movement out of range",
                    artist_id
                );
                ctx.stop_playing_music(artist_id, &mut render_commands, cur_x, cur_y, cur_z);
            }
        },
        None => {
            ctx.maybe_start_playing_new_music(&mut render_commands, cur_x, cur_y, cur_z);
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

    assert_eq!(ctx.playing_music_artist_id, Some(artist_id));

    ctx.stop_playing_music(artist_id, &mut draw_commands, cur_x, cur_y, cur_z);

    draw_commands
}
