use diesel::prelude::*;

use crate::models::User;
use crate::DbConn;

pub fn get_user_by_spotify_id(
    conn: &DbConn,
    user_spotify_id: &str,
) -> Result<Option<User>, String> {
    use crate::schema::users::dsl::*;

    let users_query_res = users
        .limit(1)
        .filter(spotify_id.eq(user_spotify_id))
        .load::<User>(&conn.0)
        .map_err(|_| -> String { "Error loading current user from the database.".into() })?;
    println!("FETCHED USERS::: {:?}", users_query_res);

    let user = users_query_res.into_iter().next();
    Ok(user)
}
