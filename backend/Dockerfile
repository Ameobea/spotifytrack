FROM debian:jessie AS builder

RUN apt-get update && apt-get install -y curl libmysqlclient-dev build-essential libssl-dev pkg-config
RUN update-ca-certificates

# Install rust
RUN curl https://sh.rustup.rs/ -sSf | \
  sh -s -- -y --default-toolchain nightly-2019-06-16

ENV PATH="/root/.cargo/bin:${PATH}"

ADD . ./

RUN cargo build --release

FROM debian:jessie

RUN apt-get update && apt-get install -y libmysqlclient-dev

COPY --from=builder \
  /target/release/spotify-homepage-backend \
  /usr/local/bin/

RUN apt-get update && apt-get install -y libssl-dev ca-certificates && update-ca-certificates
WORKDIR /root
RUN touch .env
CMD ROCKET_PORT=$PORT /usr/local/bin/spotify-homepage-backend
