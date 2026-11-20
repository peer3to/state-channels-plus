# The parachain dev node for --parachain runs, built against the runner image's
# Debian release so its glibc matches. Build context: a peer3-parachain checkout.
#   git -C <peer3-parachain> archive <commit> \
#     | docker build -t peer3/zero-fee-node:<commit> -f scripts/e2e-parallel/distributed/parachain-node.Dockerfile -
FROM rust:1.91.1-bookworm AS build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends clang libclang-dev protobuf-compiler cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
# rust-toolchain.toml pins the toolchain, its components and the wasm target
RUN cargo build --release --locked -p zero-fee-node

FROM debian:bookworm-slim
COPY --from=build /src/target/release/zero-fee-node /usr/local/bin/zero-fee-node
