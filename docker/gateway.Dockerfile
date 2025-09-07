# syntax=docker/dockerfile:1.6

ARG RUST_IMAGE=rustlang/rust:nightly

# Base dev image with toolchain, sccache and cargo-chef installed
FROM ${RUST_IMAGE} AS dev-base
ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates pkg-config build-essential libssl-dev capnproto; \
    update-ca-certificates; \
    cargo install --locked sccache; \
    cargo install --locked cargo-chef; \
    mkdir -p /sccache; \
    rustc --version && cargo --version && /usr/local/cargo/bin/sccache --version

ENV RUSTC_WRAPPER=/usr/local/cargo/bin/sccache \
    SCCACHE_DIR=/sccache \
    SCCACHE_CACHE_SIZE=5G \
    PATH="/usr/local/cargo/bin:/root/.cargo/bin:${PATH}"
WORKDIR /workspace

# --- cargo-chef dependency graph ---
FROM dev-base AS planner
# Use a minimal workspace focused on the gateway and its crates to avoid desktop/mobile system deps
COPY docker/Cargo.gateway-workspace.toml ./Cargo.toml
COPY Cargo.lock ./Cargo.lock
COPY apps/gateway/Cargo.toml apps/gateway/Cargo.toml
COPY apps/gateway/src apps/gateway/src
COPY crates ./crates
# Prepare the recipe at workspace root
WORKDIR /workspace
RUN cargo chef prepare --recipe-path recipe.json

# Build and cache dependencies
FROM dev-base AS cacher
COPY --from=planner /workspace/recipe.json /workspace/recipe.json
WORKDIR /workspace
# Use BuildKit cache mounts for registry/git to persist across builds
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo chef cook --release --recipe-path recipe.json

# Build the gateway binary
FROM dev-base AS builder
# Bring in only the Rust workspace parts we need
COPY docker/Cargo.gateway-workspace.toml ./Cargo.toml
COPY Cargo.lock ./Cargo.lock
COPY crates ./crates
COPY apps/gateway ./apps/gateway
# Reuse cooked deps layer
COPY --from=cacher /usr/local/cargo /usr/local/cargo
COPY --from=cacher /workspace/target /workspace/target
# Build with cached registries/git and sccache
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/sccache \
    cargo build -p gateway --release

# --- Runtime image ---
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates libssl3; \
    update-ca-certificates; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /workspace/target/release/gateway /usr/local/bin/gateway
EXPOSE 7000
ENV RUST_LOG=info
ENTRYPOINT ["/usr/local/bin/gateway"]
