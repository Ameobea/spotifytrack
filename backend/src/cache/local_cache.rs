use std::io::Write;

use fnv::FnvHashMap as HashMap;
use lazy_static::lazy_static;
use tokio::{
    sync::{Mutex, RwLock},
    task::spawn_blocking,
};

const SPOTIFY_ID_CACHE_FILE_NAME: &str = "./spotify_id_map.kv";

lazy_static! {
    static ref SPOTIFY_ID_BY_INTERNAL_ID_CACHE: RwLock<HashMap<i32, String>> =
        RwLock::new(HashMap::default());
    static ref INTERNAL_ID_BY_SPOTIFY_ID_CACHE: RwLock<HashMap<String, i32>> =
        RwLock::new(HashMap::default());
    static ref CACHE_FILE_LOCK: Mutex<()> = Mutex::new(());
}

pub(crate) async fn get_cached_internal_ids_by_spotify_id(
    spotify_ids: impl Iterator<Item = String>,
) -> Vec<Option<i32>> {
    let locked = INTERNAL_ID_BY_SPOTIFY_ID_CACHE.read().await;
    spotify_ids
        .map(|spotify_id| locked.get(&spotify_id).cloned())
        .collect()
}

pub(crate) async fn cache_id_entries<T: Into<String>>(
    entries: impl Iterator<Item = (i32, T)> + Clone,
) {
    let mut locked = SPOTIFY_ID_BY_INTERNAL_ID_CACHE.write().await;
    for (internal_id, spotify_id) in entries.clone() {
        locked.insert(internal_id, spotify_id.into());
    }
    drop(locked);

    let mut locked = INTERNAL_ID_BY_SPOTIFY_ID_CACHE.write().await;
    for (internal_id, spotify_id) in entries.clone() {
        locked.insert(spotify_id.into(), internal_id);
    }
    drop(locked);

    let _locked = CACHE_FILE_LOCK.lock().await;
    let mut file = spawn_blocking(|| {
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .append(true)
            .open(SPOTIFY_ID_CACHE_FILE_NAME)
            .unwrap()
    })
    .await
    .unwrap();

    for (internal_id, spotify_id) in entries {
        let line = format!("{} {}\n", internal_id, spotify_id.into());
        file.write_all(line.as_bytes()).unwrap();
    }
}

pub(crate) async fn init_spotify_id_map_cache() {
    let cache_entries: Vec<_> = spawn_blocking(|| {
        let file_content = std::fs::read_to_string(SPOTIFY_ID_CACHE_FILE_NAME).unwrap_or_default();

        file_content
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let mut parts = line.split_whitespace();
                let internal_id = parts.next().unwrap().parse::<i32>().unwrap();
                let spotify_id = parts.next().unwrap();
                (spotify_id.to_string(), internal_id)
            })
            .collect()
    })
    .await
    .unwrap();

    let mut spotify_id_by_internal_id_cache = SPOTIFY_ID_BY_INTERNAL_ID_CACHE.write().await;
    for (spotify_id, internal_id) in &cache_entries {
        spotify_id_by_internal_id_cache.insert(*internal_id, spotify_id.clone());
    }
    drop(spotify_id_by_internal_id_cache);

    let mut internal_id_by_spotify_id_cache = INTERNAL_ID_BY_SPOTIFY_ID_CACHE.write().await;
    for (spotify_id, internal_id) in cache_entries {
        internal_id_by_spotify_id_cache.insert(spotify_id, internal_id);
    }
}
