use foundations::telemetry::metrics::{metrics, Counter, HistogramBuilder, TimeHistogram};

use foundations;

#[metrics]
pub(crate) mod metrics {
    /// Total number of requests made to all Spotify API endpoints
    pub fn spotify_api_requests_total(endpoint_name: &'static str) -> Counter;

    /// Total number of successful requests made to all Spotify API endpoints
    pub fn spotify_api_requests_success_total(endpoint_name: &'static str) -> Counter;

    /// Total number of failed requests made to all Spotify API endpoints
    pub fn spotify_api_requests_failure_total(endpoint_name: &'static str) -> Counter;

    /// Total number of rate limited requests made to all Spotify API endpoints
    pub fn spotify_api_requests_rate_limited_total(endpoint_name: &'static str) -> Counter;

    /// Distribution of response times for the Spotify API
    #[ctor = HistogramBuilder {
        buckets: &[0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 1.0, 2.5, 5.0, 10.0],
    }]
    pub fn spotify_api_response_time(endpoint_name: &'static str) -> TimeHistogram;

    /// Total number of successful user updates
    pub fn user_updates_success_total() -> Counter;

    /// Total number of failed user updates
    pub fn user_updates_failure_total() -> Counter;

    /// Total number of successful external user data retrieval events
    pub fn external_user_data_retrieval_success_total() -> Counter;

    /// Total number of failed external user data retrieval events
    pub fn external_user_data_retrieval_failure_total() -> Counter;

    /// Distribution of user data retrieval times
    #[ctor = HistogramBuilder {
        buckets: &[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 60.0, 120.0, 300.0, 600.0],
    }]
    pub fn external_user_data_retrieval_time() -> TimeHistogram;

    /// Total number of successful external user data export events
    pub fn external_user_data_export_success_total() -> Counter;

    /// Total number of failed external user data export events
    pub fn external_user_data_export_failure_total() -> Counter;

    /// Distribution of user data export times
    #[ctor = HistogramBuilder {
        buckets: &[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 60.0, 120.0, 300.0, 600.0],
    }]
    pub fn external_user_data_export_time() -> TimeHistogram;
}

pub use metrics::*;
