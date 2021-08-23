use std::time::Instant;

pub(crate) fn start() -> Instant { Instant::now() }

pub(crate) fn mark(last: Instant, msg: &str) {
    let now = Instant::now();
    let diff = now.saturating_duration_since(last);
    info!("[{:?}] {}", diff, msg);
}
