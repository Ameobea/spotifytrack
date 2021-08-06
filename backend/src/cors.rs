use rocket::{
    fairing::{Fairing, Info, Kind},
    http::{Method, Status},
    Request, Response,
};

pub(crate) struct CorsFairing;

#[rocket::async_trait]
impl Fairing for CorsFairing {
    async fn on_response<'r>(&self, req: &'r Request<'_>, res: &mut Response<'r>) {
        // Add CORS headers to allow all origins to all outgoing requests
        res.set_header(rocket::http::Header::new(
            "Access-Control-Allow-Origin",
            "*",
        ));
        res.set_header(rocket::http::Header::new(
            "Access-Control-Allow-Headers",
            "sentry-trace",
        ));

        // Respond to all `OPTIONS` requests with a `204` (no content) status
        if res.status() == Status::NotFound && req.method() == Method::Options {
            res.set_status(Status::NoContent);
        }
    }

    fn info(&self) -> Info {
        Info {
            name: "CORS Fairing",
            kind: Kind::Response,
        }
    }
}
