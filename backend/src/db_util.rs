use diesel::prelude::*;

use crate::models::User;
use crate::DbConn;

pub fn get_user_by_spotify_id(
    conn: &DbConn,
    supplied_spotify_id: &str,
) -> Result<Option<User>, String> {
    use crate::schema::users::dsl::*;

    diesel_not_found_to_none(
        users
            .filter(spotify_id.eq(&supplied_spotify_id))
            .first::<User>(&conn.0),
    )
}

pub fn diesel_not_found_to_none<T>(
    res: Result<T, diesel::result::Error>,
) -> Result<Option<T>, String> {
    match res {
        Err(diesel::result::Error::NotFound) => Ok(None),
        Err(err) => {
            error!("Error querying user from database: {:?}", err);
            Err("Error querying database for user.".into())
        }
        Ok(res) => Ok(Some(res)),
    }
}
