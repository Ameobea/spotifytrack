use std::sync::Mutex;
use std::time::Instant;

lazy_static! {
    pub static ref LAST: Mutex<Instant> = Mutex::new(Instant::now());
}

pub fn start() {
    *LAST.lock().unwrap() = Instant::now();
}

pub fn mark(msg: &str) -> Instant {
    let now = Instant::now();
    let diff = now - *LAST.lock().unwrap();

    info!("[{:?}] {}", diff, msg);
    start();
    now
}
