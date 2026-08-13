use chrono::Utc;
use sha2::{Digest, Sha256};

const ANALYTICS_ENDPOINT: &str = "https://osu-api-bridge.ameo.dev/a/z";
const ANALYTICS_SALT: &str = "4rW9XKHcEKa6bolWry8k0LGW";
const ANALYTICS_PROJECT: &str = "spotifytrack";

/// Fire-and-forget dispatch to the ameotrack ingest.  `client_ip`/`user_agent` should be those of
/// the end user so the event groups with their other activity; a synthetic daily-rotating session
/// ID is derived from them like sprout's server-side events.
pub(crate) fn submit_server_analytics_event(
    category: &'static str,
    subcategory: &'static str,
    payload: serde_json::Value,
    client_ip: Option<String>,
    user_agent: Option<String>,
) {
    let mut hasher = Sha256::new();
    hasher.update(category.as_bytes());
    hasher.update(subcategory.as_bytes());
    hasher.update(ANALYTICS_SALT.as_bytes());
    let verification = hex::encode(hasher.finalize());

    let session_id = client_ip.as_deref().map(|ip| {
        let mut hasher = Sha256::new();
        hasher.update(ip.as_bytes());
        hasher.update(user_agent.as_deref().unwrap_or("").as_bytes());
        hasher.update(Utc::now().format("%Y-%m-%d").to_string().as_bytes());
        hasher.update(ANALYTICS_SALT.as_bytes());
        hex::encode(hasher.finalize())[..16].to_owned()
    });

    let mut body = serde_json::json!({
        "events": [{ "category": category, "subcategory": subcategory, "payload": payload }],
        "verification": verification,
        "project": ANALYTICS_PROJECT,
    });
    if let Some(session_id) = session_id {
        body["session_id"] = serde_json::Value::String(session_id);
    }

    tokio::spawn(async move {
        let client = crate::spotify_api::get_reqwest_client().await;
        let mut req = client.post(ANALYTICS_ENDPOINT).json(&body);
        if let Some(ip) = client_ip {
            req = req.header("X-Forwarded-For", ip);
        }
        if let Some(ua) = user_agent {
            req = req.header("User-Agent", ua);
        }
        if let Err(err) = req.send().await {
            warn!("Failed to submit server analytics event: {err}");
        }
    });
}
