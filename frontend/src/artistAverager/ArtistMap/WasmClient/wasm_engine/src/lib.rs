#![feature(box_syntax, new_uninit)]
#![allow(invalid_value)]

#[macro_use]
extern crate log;

use std::{collections::HashMap, sync::Once};

use bitflags::bitflags;
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
}

impl Default for ArtistMapCtx {
    fn default() -> Self {
        ArtistMapCtx {
            last_position: [f32::INFINITY, f32::INFINITY, f32::INFINITY],
            artists_indices_by_id: HashMap::new(),
            all_artists: Vec::new(),
            partitions: unsafe { std::mem::MaybeUninit::uninit().assume_init() },
            total_rendered_label_count: 0,
        }
    }
}

const DISTANCE_MULTIPLIER: f32 = 7430.;
const LABEL_RENDER_DISTANCE: f32 = 8320.;

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
            for val in &mut pos {
                *val *= DISTANCE_MULTIPLIER;
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

            let state_ref = &mut ctx.all_artists.last_mut().unwrap().1;

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

    // let mut matched_partition_count = 0;
    // let radiuses = [LABEL_RENDER_DISTANCE, ARTIST_GEOMETRY_RENDER_DISTANCE];
    // for IteredPartition {
    //     artist_indices,
    //     in_range,
    //     ..
    // } in ctx.partitions.iter_approx_near_spherical_envelope(
    //     delta_distance,
    //     ctx.last_position,
    //     radiuses,
    // ) {
    //     matched_partition_count += 1;

    //     for &artist_ix in artist_indices {
    //         let (artist_id, artist_state) = &mut ctx.all_artists[artist_ix];
    //         let distance = distance(&artist_state.position, &ctx.last_position);

    //         if !in_range[0].contains(InRange::IN_RANGE_OF_ENVELOPE)
    //             && !in_range[1].contains(InRange::IN_RANGE_OF_ENVELOPE)
    //         {
    //             error!("Matched partition but neither in range of envelope");
    //         }

    //         if in_range[0].contains(InRange::IN_RANGE_OF_ENVELOPE) {
    //             let should_render_label = distance <= LABEL_RENDER_DISTANCE;

    //             if should_render_label
    //                 != artist_state
    //                     .render_state
    //                     .contains(ArtistRenderState::RENDER_LABEL)
    //             {
    //                 if should_render_label {
    //                     if artist_state
    //                         .render_state
    //                         .contains(ArtistRenderState::HAS_NAME)
    //                     {
    //                         artist_state
    //                             .render_state
    //                             .toggle(ArtistRenderState::RENDER_LABEL);
    //                         render_commands.push(0);
    //                     } else {
    //                         render_commands.push(4);
    //                     }
    //                 } else {
    //                     render_commands.push(1);
    //                     artist_state
    //                         .render_state
    //                         .toggle(ArtistRenderState::RENDER_LABEL);
    //                 }
    //                 render_commands.push(*artist_id);
    //             }
    //         }

    //         if in_range[1].contains(InRange::IN_RANGE_OF_ENVELOPE) {
    //             let should_render_geometry =
    //                 distance <= ARTIST_GEOMETRY_RENDER_DISTANCE || artist_state.popularity >= 90;
    //             if should_render_geometry
    //                 != artist_state
    //                     .render_state
    //                     .contains(ArtistRenderState::RENDER_GEOMETRY)
    //             {
    //                 if should_render_geometry {
    //                     render_commands.push(2);
    //                 } else {
    //                     render_commands.push(3);
    //                 }
    //                 render_commands.push(*artist_id);

    //                 artist_state
    //                     .render_state
    //                     .toggle(ArtistRenderState::RENDER_GEOMETRY);
    //             }
    //         }
    //     }
    // }
    // info!("matched_partition_count={}", matched_partition_count);

    render_commands
}
