# The parachain dev node for --parachain runs, built against the runner image's
# Debian release so its glibc matches. Context: a clean export of one
# peer3-parachain commit; the image is pushed to ghcr.io/peer3to/zero-fee-node
# and runner-image.Dockerfile pins its digest.
#   git -C <peer3-parachain> archive <commit> | tar -x -C <empty dir>
#   docker build -t ghcr.io/peer3to/zero-fee-node:<commit> \
#     -f scripts/e2e-parallel/distributed/parachain-node.Dockerfile <empty dir>
FROM rust:1.91.1-bookworm AS build

RUN apt-get update \
    && apt-get install --yes --no-install-recommends clang libclang-dev protobuf-compiler cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
# rust-toolchain.toml pins the toolchain, its components and the wasm target
RUN cargo build --release --locked -p zero-fee-node

FROM debian:bookworm-slim
# links the GHCR package to this repo, so its workflows can pull it
LABEL org.opencontainers.image.source=https://github.com/peer3to/state-channels-plus
COPY --from=build /src/target/release/zero-fee-node /usr/local/bin/zero-fee-node
