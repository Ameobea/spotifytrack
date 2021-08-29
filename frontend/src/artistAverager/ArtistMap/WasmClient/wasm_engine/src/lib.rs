#![feature(box_syntax, new_uninit)]
#![allow(invalid_value)]

#[macro_use]
extern crate log;

use std::{collections::VecDeque, sync::Once};

use bitflags::bitflags;
use float_ord::FloatOrd;
use fnv::{FnvHashMap as HashMap, FnvHashSet as HashSet};
use wasm_bindgen::prelude::*;

// mod partitioning;

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
        const IS_HIGHLIGHTED = 0b0010_0000;
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
    pub all_artist_relationships: Vec<ArtistRelationships>,
    pub total_rendered_label_count: usize,
    pub playing_music_artist_id: Option<u32>,
    pub most_recently_played_artist_ids: VecDeque<u32>,
    pub connections_buffer: Vec<[[f32; 3]; 2]>,
    pub rendered_connections: HashSet<(usize, usize)>,
}

const DISTANCE_MULTIPLIER: [f32; 3] = [24000., 24000., 32430.];
const LABEL_RENDER_DISTANCE: f32 = 12320.;
const MAX_MUSIC_PLAY_DISTANCE: f32 = 4000.;
const MAX_RECENTLY_PLAYED_ARTISTS_TO_TRACK: usize = 32;
const MAX_RELATED_ARTIST_COUNT: usize = 20;
const MAX_RENDERED_CONNECTION_LENGTH: f32 = 4740.;

impl Default for ArtistMapCtx {
    fn default() -> Self {
        ArtistMapCtx {
            last_position: [f32::INFINITY, f32::INFINITY, f32::INFINITY],
            artists_indices_by_id: HashMap::default(),
            all_artists: Vec::new(),
            all_artist_relationships: Vec::new(),
            total_rendered_label_count: 0,
            playing_music_artist_id: None,
            most_recently_played_artist_ids: VecDeque::new(),
            connections_buffer: Vec::new(),
            rendered_connections: HashSet::default(),
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

    pub fn update_connections_buffer(&mut self, new_artist_ids: &[u32]) {
        // Just render everything for now
        for artist_id in new_artist_ids {
            let src_artist_ix = *self.artists_indices_by_id.get(artist_id).unwrap();
            let src_pos = self.all_artists[src_artist_ix].1.position;
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
                let dst_pos = self.all_artists[related_artist_ix].1.position;

                // Skip rendering very long connections for now
                if distance(&src_pos, &dst_pos) > MAX_RENDERED_CONNECTION_LENGTH {
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

                self.connections_buffer.push([src_pos, dst_pos]);
                relationship.connections_buffer_index = Some(self.connections_buffer.len() - 1);
            }
        }
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
    if distance < 3000. {
        return true;
    }

    let mut score = distance;

    // Higher popularity artists show up further away
    score -= (artist_state.popularity as f32).powi(2) * 2.2;

    // If we're in a very dense area with many labels rendered, make it harder to render more
    score += fastapprox::faster::pow(total_rendered_label_count as f32, 1.3) * 22.2;

    if artist_state
        .render_state
        .contains(ArtistRenderState::IS_HIGHLIGHTED)
    {
        score *= 0.42;
    }

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
            ctx.all_artist_relationships.push(Default::default());

            ctx.artists_indices_by_id
                .insert(id, ctx.all_artists.len() - 1);
        }
    }

    info!("Successfully parsed + stored {} artist positions", count);
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

fn should_render_artist(distance: f32, popularity: u8, render_state: &ArtistRenderState) -> bool {
    if popularity >= 85 {
        return true;
    }

    if distance < 2000. {
        return true;
    }

    if render_state.contains(ArtistRenderState::IS_HIGHLIGHTED) {
        return true;
    }

    let mut score = distance;
    score -= (popularity as f32).powi(3) * 0.1;

    score < 10_800.
}

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
                if ctx.total_rendered_label_count == 0 {
                    error!(
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

    let projected_next_pos = [projected_next_x, projected_next_y, projected_next_z];
    match ctx.playing_music_artist_id {
        Some(artist_id) => {
            let artist_index = ctx.artists_indices_by_id.get(&artist_id).unwrap();
            if distance(
                &ctx.all_artists[*artist_index].1.position,
                &projected_next_pos,
            ) > MAX_MUSIC_PLAY_DISTANCE
            {
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

    ctx.stop_playing_music(artist_id, &mut draw_commands, cur_x, cur_y, cur_z);

    draw_commands
}

/// Returns connection buffer length
#[wasm_bindgen]
pub fn handle_artist_relationship_data(
    ctx: *mut ArtistMapCtx,
    artist_ids: Vec<u32>,
    packed_relationship_data: Vec<u8>,
) -> usize {
    let ctx = unsafe { &mut *ctx };

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
    ctx.update_connections_buffer(&artist_ids);

    ctx.connections_buffer.len() * 6
}

#[wasm_bindgen]
pub fn get_connections_buffer_ptr(ctx: *mut ArtistMapCtx) -> *const f32 {
    let ctx = unsafe { &mut *ctx };
    ctx.connections_buffer.as_ptr() as *const f32
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
        let should_render =
            should_render_artist(distance_to_artist, state.popularity, &state.render_state);
        if should_render {
            draw_commands.push(2);
            draw_commands.push(*artist_id);
        } else {
            draw_commands.push(3);
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
        draw_commands.push(2);
        draw_commands.push(highlighted_artist_id);
    }

    draw_commands
}
