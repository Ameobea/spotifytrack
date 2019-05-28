//! Functions for interacting with Redis which caches data from the Spotify API.

use r2d2_redis::redis::Commands;
use r2d2_redis::{r2d2, RedisConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json;

use crate::conf::CONF;

lazy_static! {
    pub static ref REDIS_CONN_POOL: r2d2::Pool<RedisConnectionManager> = {
        let manager = RedisConnectionManager::new(CONF.redis_url.as_str())
            .expect("Failed to create Redis connection manager");
        r2d2::Pool::builder()
            .build(manager)
            .expect("Failed to build Redis connection pool")
    };
}

fn get_conn() -> Result<diesel::r2d2::PooledConnection<RedisConnectionManager>, String> {
    REDIS_CONN_POOL.get().map_err(|err| -> String {
        error!("Error getting client from connection pool: {:?}", err);
        "Error connecting to Spotify metadata cache".into()
    })
}

pub fn set_hash_items<T: Serialize>(hash_name: &str, kv_pairs: &[(&str, T)]) -> Result<(), String> {
    let kv_pairs_serialized = kv_pairs
        .into_iter()
        .map(|(key, val)| -> Result<(&str, String), String> {
            let serialized: String = serde_json::to_string(val).map_err(|err| -> String {
                error!("Error serializing value to string: {:?}", err);
                "Error saving items to cache".into()
            })?;

            Ok((key, serialized))
        })
        .collect::<Result<Vec<_>, String>>()?;

    get_conn()?
        .hset_multiple::<&str, &str, String, ()>(hash_name, &kv_pairs_serialized)
        .map_err(|err| -> String {
            error!(
                "Error setting hash items into hash \"{}\": {:?}",
                hash_name, err
            );
            "Error setting values into cache".into()
        })
}

pub fn get_hash_items<T: for<'de> Deserialize<'de>>(
    hash_name: &str,
    keys: &[&str],
) -> Result<Vec<Option<T>>, String> {
    let conn = get_conn()?;

    let mut cmd = redis::cmd("HMGET");
    let cmd = keys
        .into_iter()
        .fold(cmd.arg(hash_name), |acc, key| acc.arg(*key));

    cmd.query::<Vec<Option<String>>>(&*conn)
        .map_err(|err| -> String {
            error!("Error pulling data from Redis cache: {:?}", err);
            "Error pulling data from Redis cache".into()
        })?
        .into_iter()
        .map(|opt: Option<String>| match opt {
            Some(val) => serde_json::from_str(&val).map_err(|err| -> String {
                error!("Error deserializing value: {:?}", err);
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

    set_hash_items(
        "__test",
        &[("key1", Foo("val1".into())), ("key3", Foo("val3".into()))],
    )
    .expect("Error setting hash items");
    let vals: Vec<Option<Foo>> =
        get_hash_items("__test", &["key1", "key2", "key3"]).expect("Error fetching hash values");

    assert_eq!(
        vals,
        vec![Some(Foo("val1".into())), None, Some(Foo("val3".into()))]
    );
}
