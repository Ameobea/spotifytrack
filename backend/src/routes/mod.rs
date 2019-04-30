use diesel::{self, prelude::*};

use rocket::http::RawStr;
use rocket_contrib::json::Json;

use crate::models::{StatsSnapshot};
use crate::schema;
use crate::DbConn;

#[get("/")]
pub fn index() -> &'static str {
    "Application successfully started!"
}

/// Retrieves the current top tracks and artist for the current user
#[get("/<username>")]
pub fn get_current_stats(conn: DbConn, username: String) -> Result<Json<StatsSnapshot>, String> {
    unimplemented!(); // TODO
}

#[post("/connect", data = "<account_data>")]
pub fn connect_to_spotify(conn: DbConn, account_data: String) -> Result<(), ()> {
    Ok(()) // TODO
}

#[get("/oauth_cb?<error>&<code>&<state>")]
pub fn oauth_cb(conn: DbConn, error: Option<&RawStr>, code: Option<&RawStr>, state: Option<&RawStr>) {
    unimplemented!(); // TODO
}
