FROM oven/bun:1

# Install Node.js 22.x (for Vite 7 requirements) and cleanup
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg build-essential pkg-config libssl-dev capnproto; \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    node -v && npm -v; \
    # Install Rust toolchain (nightly) for gateway/desktop dev
    curl -fsSL https://sh.rustup.rs | bash -s -- -y --default-toolchain nightly; \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace
