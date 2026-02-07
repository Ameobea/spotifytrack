FROM debian:trixie-slim AS builder

RUN apt-get update && apt-get install -y \
  curl \
  libmariadb-dev-compat \
  build-essential \
  libssl-dev \
  pkg-config \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install rust
RUN curl https://sh.rustup.rs/ -sSf | \
  sh -s -- -y --default-toolchain nightly-2026-01-12

ENV PATH="/root/.cargo/bin:${PATH}"

ADD . ./

RUN RUSTFLAGS="--cfg tokio_unstable --cfg foundations_unstable" cargo build --release

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y \
  libmariadb3 \
  libssl3t64 \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && update-ca-certificates

COPY --from=builder \
  /target/release/spotify-homepage-backend \
  /usr/local/bin/

WORKDIR /root
RUN touch .env
CMD ROCKET_PORT=$PORT /usr/local/bin/spotify-homepage-backend
