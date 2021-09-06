//! Functions for interacting with Redis which caches data from the Spotify API.

use r2d2_redis::{r2d2, redis::Commands, RedisConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json;

use crate::conf::CONF;

pub mod local_cache;

lazy_static::lazy_static! {
    pub static ref REDIS_CONN_POOL: r2d2::Pool<RedisConnectionManager> = {
        let manager = RedisConnectionManager::new(CONF.redis_url.as_str())
            .map_err(|err| {
                error!("Failed to create Redis connection manager: {:?}", err);
                std::process::exit(1);
            })
            .unwrap();
        r2d2::Pool::builder()
            .build(manager)
            .map_err(|err| {
                error!("Failed to build Redis connection pool: {:?}", err);
                std::process::exit(1);
            })
            .unwrap()
    };
}

pub fn get_redis_conn() -> Result<diesel::r2d2::PooledConnection<RedisConnectionManager>, String> {
    REDIS_CONN_POOL.get().map_err(|err| -> String {
        error!("Error getting client from connection pool: {:?}", err);
        "Error connecting to Spotify metadata cache".into()
    })
}

pub(crate) fn set_hash_items<T: Serialize>(
    hash_name: &str,
    kv_pairs: &[(&str, T)],
) -> Result<(), String> {
    if kv_pairs.is_empty() {
        return Ok(());
    }

    let kv_pairs_serialized = kv_pairs
        .iter()
        .map(|(key, val)| -> Result<(&str, String), String> {
            let serialized: String = serde_json::to_string(val).map_err(|err| -> String {
                error!("Error serializing value to string: {:?}", err);
                "Error saving items to cache".into()
            })?;

            Ok((key, serialized))
        })
        .collect::<Result<Vec<_>, String>>()?;

    get_redis_conn()?
        .hset_multiple::<&str, &str, String, ()>(hash_name, &kv_pairs_serialized)
        .map_err(|err| -> String {
            error!(
                "Error setting hash items into hash \"{}\": {:?}",
                hash_name, err
            );
            "Error setting values into cache".into()
        })
}

pub(crate) fn get_hash_items<T: for<'de> Deserialize<'de>>(
    hash_name: &str,
    keys: &[&str],
) -> Result<Vec<Option<T>>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }

    let mut conn = get_redis_conn()?;

    let mut cmd = redis::cmd("HMGET");
    let cmd = keys
        .iter()
        .fold(cmd.arg(hash_name), |acc, key| acc.arg(*key));

    cmd.query::<Vec<Option<String>>>(&mut *conn)
        .map_err(|err| -> String {
            error!("Error pulling data from Redis cache: {:?}", err);
            "Error pulling data from Redis cache".into()
        })?
        .into_iter()
        .enumerate()
        .map(|(i, opt): (usize, Option<String>)| match opt {
            Some(val) => serde_json::from_str(&val).map_err(|err| -> String {
                error!(
                    "Error deserializing value of {}: {:?}; key={}; val={}",
                    std::any::type_name::<T>(),
                    err,
                    keys.get(i).unwrap_or(&"<NO KEY FOUND FOR INDEX>"),
                    val
                );
                "Error reading values from cache".into()
            }),
            None => Ok(None),
        })
        .collect::<Result<Vec<Option<T>>, String>>()
}

#[test]
fn cache_set_get() {
    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Foo(String);

    set_hash_items("__test", &[
        ("key1", Foo("val1".into())),
        ("key3", Foo("val3".into())),
    ])
    .expect("Error setting hash items");
    let vals: Vec<Option<Foo>> =
        get_hash_items("__test", &["key1", "key2", "key3"]).expect("Error fetching hash values");

    assert_eq!(vals, vec![
        Some(Foo("val1".into())),
        None,
        Some(Foo("val3".into()))
    ]);
}
