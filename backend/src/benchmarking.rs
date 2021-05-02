use std::{sync::Mutex, time::Instant};

lazy_static! {
    pub static ref LAST: Mutex<Instant> = Mutex::new(Instant::now());
}

pub(crate) fn start() { *LAST.lock().unwrap() = Instant::now(); }

pub(crate) fn mark(msg: &str) {
    let mut last = LAST.lock().unwrap();
    let now = Instant::now();
    let diff = now.saturating_duration_since(*last);
    info!("[{:?}] {}", diff, msg);
    *last = now;
}
