FROM rustlang/rust:nightly

# Preinstall system build deps once for dev image
RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      capnproto pkg-config libssl-dev build-essential ca-certificates sccache; \
    update-ca-certificates; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Optional: keep a writable dir for cargo caches (compose will mount volumes)
ENV RUSTC_WRAPPER=/usr/bin/sccache \
    CARGO_TERM_COLOR=always

CMD ["bash","-lc","/usr/local/cargo/bin/cargo run --manifest-path apps/gateway/Cargo.toml"]

