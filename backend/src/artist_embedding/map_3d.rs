use tokio::sync::OnceCell;

use crate::artist_embedding::{parse_positions, ArtistEmbeddingContext};

const PACKED_3D_ARTIST_COORDS_URL: &str = "https://ameo.dev/artist_map_embedding_3d.w2v";

async fn build_3d_artist_map_ctx() -> ArtistEmbeddingContext<3> {
    let raw_positions: String = reqwest::get(PACKED_3D_ARTIST_COORDS_URL)
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    println!("Successfully fetched 3d artist map embedding positions.  Parsing...");
    let artist_position_by_id = parse_positions(&raw_positions);
    println!(
        "Successfully parsed 3d artist map embedding positions.  Setting into global context."
    );
    ArtistEmbeddingContext {
        artist_position_by_id,
    }
}

static MAP_3D_ARTIST_CTX: OnceCell<ArtistEmbeddingContext<3>> = OnceCell::const_new();
static PACKED_3D_ARTIST_EMBEDDING: OnceCell<Vec<u8>> = OnceCell::const_new();

async fn build_packed_3d_artist_coords() -> Vec<u8> {
    let map_ctx_3d = MAP_3D_ARTIST_CTX.get_or_init(build_3d_artist_map_ctx).await;
    map_ctx_3d.serialize_to_packed_binary()
}

pub async fn get_packed_3d_artist_coords() -> &'static [u8] {
    PACKED_3D_ARTIST_EMBEDDING
        .get_or_init(build_packed_3d_artist_coords)
        .await
}
