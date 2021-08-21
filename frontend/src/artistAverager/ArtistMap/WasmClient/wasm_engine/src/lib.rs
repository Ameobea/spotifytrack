#![feature(box_syntax)]

#[macro_use]
extern crate log;

use std::{collections::HashMap, sync::Once};

use bitflags::bitflags;
use wasm_bindgen::prelude::*;

bitflags! {
    pub struct ArtistRenderState: u8 {
        const RENDER_LABEL = 0b0000_0001;
        const RENDER_CONNECTIONS = 0b0000_0010;
        const RENDER_GEOMETRY = 0b0000_0100;
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
    pub artists_positions_by_id: HashMap<u32, [f32; 3]>,
    pub all_artists: Vec<(u32, ArtistState)>,
}

impl Default for ArtistMapCtx {
    fn default() -> Self {
        ArtistMapCtx {
            last_position: [f32::INFINITY, f32::INFINITY, f32::INFINITY],
            artists_positions_by_id: HashMap::new(),
            all_artists: Vec::new(),
        }
    }
}

const DISTANCE_MULTIPLIER: f32 = 3830.;
const LABEL_RENDER_DISTANCE: f32 = 20.;
const ARTIST_GEOMETRY_RENDER_DISTANCE: f32 = 80.;

const DID_INIT: Once = Once::new();

fn maybe_init() {
    DID_INIT.call_once(|| {
        if cfg!(debug_assertions) {
            console_error_panic_hook::set_once();
            wasm_logger::init(wasm_logger::Config::default());
        }
    })
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

    let ptr = unsafe { ptr.add(1) };
    for i in 0..count {
        unsafe {
            let id: u32 = *ptr.add(i);
            let pos: &[f32; 3] = &*(ptr.add(count + i * 3) as *const _);
            let mut pos: [f32; 3] = *pos;
            for val in &mut pos {
                *val *= DISTANCE_MULTIPLIER;
            }

            let state = ArtistState {
                position: pos.clone(),
                popularity: 0, // TODO
                render_state: ArtistRenderState::empty(),
            };
            ctx.all_artists.push((id, state));

            ctx.artists_positions_by_id.insert(id, pos);
        }
    }

    info!("Successfully parsed + stored {} artist positions", count);
    count
}

const MISSING_POS: [f32; 3] = [f32::NAN, f32::NAN, f32::NAN];

#[wasm_bindgen]
pub fn get_artist_positions(ctx: *mut ArtistMapCtx, artist_ids: Vec<u32>) -> Vec<f32> {
    let ctx = unsafe { &mut *ctx };

    let mut out = Vec::with_capacity(3 * artist_ids.len());
    unsafe { out.set_len(3 * artist_ids.len()) };

    for (artist_ix, artist_id) in artist_ids.into_iter().enumerate() {
        let pos = ctx
            .artists_positions_by_id
            .get(&artist_id)
            .unwrap_or_else(|| {
                // error!(
                //     "Artist id not in embedding: {}, using 0,0,0 position",
                //     artist_id
                // );
                &MISSING_POS
            });

        for (dim_ix, val_for_dim) in pos.iter().enumerate() {
            out[artist_ix * 3 + dim_ix] = *val_for_dim;
        }
    }

    out
}

#[wasm_bindgen]
pub fn get_all_artist_positions(ctx: *mut ArtistMapCtx) -> Vec<f32> {
    let ctx = unsafe { &mut *ctx };

    let mut out: Vec<f32> = Vec::with_capacity(ctx.all_artists.len() * 4);
    unsafe { out.set_len(ctx.all_artists.len() * 4) };

    for (i, (artist_id, state)) in ctx.all_artists.iter().enumerate() {
        out[i * 4] = unsafe { std::mem::transmute(*artist_id) };

        for (dim_ix, val_for_dim) in state.position.iter().enumerate() {
            out[i * 4 + 1 + dim_ix] = *val_for_dim;
        }
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

#[wasm_bindgen]
pub fn handle_new_position(ctx: *mut ArtistMapCtx, cur_x: f32, cur_y: f32, cur_z: f32) -> Vec<u32> {
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
    let mut render_commands: Vec<u32> = Vec::new();

    // Loop through all artists and check which ones need to be updated based on the new position of the user
    for (id, state) in &mut ctx.all_artists {
        let distance = distance(&state.position, &ctx.last_position);

        let should_render_label = distance <= LABEL_RENDER_DISTANCE;
        if should_render_label != state.render_state.contains(ArtistRenderState::RENDER_LABEL) {
            if should_render_label {
                render_commands.push(0);
            } else {
                render_commands.push(1);
            }
            render_commands.push(*id);

            state.render_state.toggle(ArtistRenderState::RENDER_LABEL);
        }

        let should_render_geometry =
            distance <= ARTIST_GEOMETRY_RENDER_DISTANCE || state.popularity >= 90;
        if should_render_geometry
            != state
                .render_state
                .contains(ArtistRenderState::RENDER_GEOMETRY)
        {
            if should_render_geometry {
                render_commands.push(2);
            } else {
                render_commands.push(3);
            }
            render_commands.push(*id);

            state
                .render_state
                .toggle(ArtistRenderState::RENDER_GEOMETRY);
        }
    }

    render_commands
}
