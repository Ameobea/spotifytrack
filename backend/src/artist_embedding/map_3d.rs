use std::convert::TryInto;

use fnv::FnvHashMap as HashMap;
use tokio::{sync::OnceCell, task::spawn_blocking};

use crate::{
    artist_embedding::{parse_positions, ArtistEmbeddingContext},
    db_util::{get_artist_spotify_ids_by_internal_id, get_internal_ids_by_spotify_id},
    spotify_api::fetch_artists,
    DbConn,
};

// const PACKED_3D_ARTIST_COORDS_URL: &str = "https://ameo.dev/artist_map_embedding_3d.w2v";
// const PACKED_3D_ARTIST_COORDS_URL: &str = "https://ameo.dev/pca.w2v";
const PACKED_3D_ARTIST_COORDS_URL: &str =
    "https://ameo.dev/100k_pop_filtered_corpus_p_16_q_1_pca.w2v";

async fn build_3d_artist_map_ctx(
    conn: &DbConn,
    spotify_access_token: &str,
) -> ArtistEmbeddingContext<3> {
    let raw_positions: String = reqwest::get(PACKED_3D_ARTIST_COORDS_URL)
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    println!("Successfully fetched 3d artist map embedding positions.  Parsing...");
    let artist_position_by_id = parse_positions(&raw_positions);

    let mut map_ctx_3d = ArtistEmbeddingContext::new(artist_position_by_id);

    let all_artist_internal_ids: Vec<i32> = map_ctx_3d
        .artist_position_by_id
        .keys()
        .map(|key| (*key) as i32)
        .collect();
    let artist_spotify_ids_by_internal_id: HashMap<i32, String> =
        get_artist_spotify_ids_by_internal_id(conn, all_artist_internal_ids)
            .await
            .unwrap();
    let artist_spotify_ids: Vec<String> = artist_spotify_ids_by_internal_id
        .values()
        .map(|id| id.to_string())
        .collect();
    let popularities = get_all_artist_popularities_by_id(spotify_access_token, artist_spotify_ids)
        .await
        .unwrap();
    info!("Fetched {} popularities", popularities.len());

    let internal_ids = get_internal_ids_by_spotify_id(conn, popularities.keys())
        .await
        .expect("Failed to fetch internal ids when building 3d artist map ctx");
    let mut popularities_by_internal_id: HashMap<i32, u8> = HashMap::default();
    for (spotify_id, popularity) in popularities {
        let internal_id = match internal_ids.get(&spotify_id) {
            Some(id) => *id,
            None => continue,
        };

        popularities_by_internal_id.insert(internal_id, popularity);
    }

    let orig_count = map_ctx_3d.artist_position_by_id.len();
    map_ctx_3d.artist_position_by_id.retain(|k, _v| {
        match popularities_by_internal_id.get(&(*k as _)) {
            Some(pop) if *pop >= MIN_POPULARITY => true,
            _ => false,
        }
    });
    map_ctx_3d.sorted_artist_ids = map_ctx_3d.artist_position_by_id.keys().copied().collect();
    map_ctx_3d.sorted_artist_ids.sort_unstable();
    let new_count = map_ctx_3d.artist_position_by_id.len();
    info!(
        "Removed {} artists from embedding due to being under popularity threshold or missing \
         popularities; new total artist count={}",
        orig_count - new_count,
        new_count
    );

    println!(
        "Successfully parsed 3d artist map embedding positions.  Setting into global context."
    );
    map_ctx_3d
}

static MAP_3D_ARTIST_CTX: OnceCell<ArtistEmbeddingContext<3>> = OnceCell::const_new();
static PACKED_3D_ARTIST_EMBEDDING: OnceCell<Vec<u8>> = OnceCell::const_new();

async fn get_all_artist_popularities_by_id(
    spotify_access_token: &str,
    all_artist_spotify_ids: Vec<String>,
) -> Result<HashMap<String, u8>, String> {
    let all_artist_spotify_ids: Vec<&str> = all_artist_spotify_ids
        .iter()
        .map(|id| id.as_str())
        .collect();
    let all_artists = fetch_artists(spotify_access_token, &all_artist_spotify_ids).await?;
    let mut artist_popularities_by_id: HashMap<String, u8> = HashMap::default();
    for artist in all_artists {
        artist_popularities_by_id.insert(
            artist.id,
            artist
                .popularity
                .map(|pop| pop.try_into().unwrap())
                .unwrap_or(10),
        );
    }
    Ok(artist_popularities_by_id)
}

const MIN_POPULARITY: u8 = 15;

pub(crate) async fn get_map_3d_artist_ctx(
    conn: &DbConn,
    spotify_access_token: &str,
) -> &'static ArtistEmbeddingContext<3> {
    MAP_3D_ARTIST_CTX
        .get_or_init(|| build_3d_artist_map_ctx(conn, spotify_access_token))
        .await
}

async fn build_packed_3d_artist_coords(
    conn: &DbConn,
    spotify_access_token: &str,
) -> Result<Vec<u8>, String> {
    let map_ctx_3d = get_map_3d_artist_ctx(conn, spotify_access_token)
        .await
        .clone();

    let all_artist_internal_ids: Vec<i32> = map_ctx_3d
        .artist_position_by_id
        .keys()
        .map(|key| (*key) as i32)
        .collect();
    let artist_spotify_ids_by_internal_id: HashMap<i32, String> =
        get_artist_spotify_ids_by_internal_id(conn, all_artist_internal_ids)
            .await
            .unwrap();
    let artist_spotify_ids: Vec<String> = artist_spotify_ids_by_internal_id
        .values()
        .map(|id| id.to_string())
        .collect();
    let popularities = get_all_artist_popularities_by_id(spotify_access_token, artist_spotify_ids)
        .await
        .unwrap();
    info!("Fetched {} popularities", popularities.len());

    let internal_ids = get_internal_ids_by_spotify_id(conn, popularities.keys()).await?;
    let mut popularities_by_internal_id: HashMap<i32, u8> = HashMap::default();
    for (spotify_id, popularity) in popularities {
        let internal_id = match internal_ids.get(&spotify_id) {
            Some(id) => *id,
            None => continue,
        };

        popularities_by_internal_id.insert(internal_id, popularity);
    }

    Ok(map_ctx_3d.serialize_to_packed_binary(Some(popularities_by_internal_id)))
}

pub async fn get_packed_3d_artist_coords(
    conn: &DbConn,
    spotify_access_token: &str,
) -> Result<&'static [u8], String> {
    PACKED_3D_ARTIST_EMBEDDING
        .get_or_try_init(|| async {
            let pre_saved_map = spawn_blocking(|| std::fs::read("packed_map_3d.bin").ok())
                .await
                .unwrap();
            if let Some(map) = pre_saved_map {
                info!("Found pre-saved 3d artist map, serving that...");
                return Ok(map);
            }

            warn!("Pre-saved packed 3D artist map not found, generating...");
            build_packed_3d_artist_coords(conn, spotify_access_token).await
        })
        .await
        .map(|v| v.as_slice())
}
