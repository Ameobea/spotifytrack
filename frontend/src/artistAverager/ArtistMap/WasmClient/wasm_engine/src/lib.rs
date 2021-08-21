#![feature(box_syntax)]

#[macro_use]
extern crate log;

use std::{collections::HashMap, sync::Once};

use wasm_bindgen::prelude::*;

pub struct ArtistMapCtx {
    pub positions_by_artist: HashMap<u32, [f32; 3]>,
}

impl Default for ArtistMapCtx {
    fn default() -> Self {
        ArtistMapCtx {
            positions_by_artist: HashMap::new(),
        }
    }
}

const DISTANCE_MULTIPLIER: f32 = 430.;

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
            ctx.positions_by_artist.insert(id, pos.clone());
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
        let pos = ctx.positions_by_artist.get(&artist_id).unwrap_or_else(|| {
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
