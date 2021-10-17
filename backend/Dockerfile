FROM debian:stable AS builder

RUN apt-get update && apt-get install -y curl libmariadbclient-dev-compat build-essential libssl-dev pkg-config
RUN update-ca-certificates

# Install rust
RUN curl https://sh.rustup.rs/ -sSf | \
  sh -s -- -y --default-toolchain nightly-2020-08-14

ENV PATH="/root/.cargo/bin:${PATH}"

ADD . ./

RUN cargo build --release

FROM debian:stable

RUN apt-get update && apt-get install -y libmariadbclient-dev-compat

COPY --from=builder \
  /target/release/spotify-homepage-backend \
  /usr/local/bin/

RUN apt-get update && apt-get install -y libssl-dev ca-certificates && update-ca-certificates
WORKDIR /root
RUN touch .env
CMD ROCKET_PORT=$PORT /usr/local/bin/spotify-homepage-backend
