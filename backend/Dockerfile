FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y curl libmariadbclient-dev-compat build-essential libssl-dev pkg-config
RUN update-ca-certificates

# Install rust
RUN curl https://sh.rustup.rs/ -sSf | \
  sh -s -- -y --default-toolchain nightly-2025-05-14

ENV PATH="/root/.cargo/bin:${PATH}"

ADD . ./

RUN RUSTFLAGS="--cfg tokio_unstable --cfg foundations_unstable" cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libmariadbclient-dev-compat

COPY --from=builder \
  /target/release/spotify-homepage-backend \
  /usr/local/bin/

RUN apt-get update && apt-get install -y libssl-dev ca-certificates && update-ca-certificates
WORKDIR /root
RUN touch .env
CMD ROCKET_PORT=$PORT /usr/local/bin/spotify-homepage-backend
