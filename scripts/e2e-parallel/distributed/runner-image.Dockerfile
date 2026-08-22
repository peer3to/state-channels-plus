ARG NODE_IMAGE=node@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213
ARG FOUNDRY_IMAGE=ghcr.io/foundry-rs/foundry@sha256:8347b728d5d393dac1c018691b36f506d23b9dcd78341d40ea0fcb11c3a19cdd
FROM ${FOUNDRY_IMAGE} AS foundry

FROM ${NODE_IMAGE}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential \
        ca-certificates \
        git \
        python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.15.0 tar@7.5.22 \
    && groupadd --gid 10001 runner \
    && useradd --uid 10001 --gid 10001 --create-home runner

COPY --from=foundry /usr/local/bin/forge /usr/local/bin/forge
COPY --from=foundry /usr/local/bin/cast /usr/local/bin/cast
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
COPY --from=foundry /usr/local/bin/chisel /usr/local/bin/chisel

USER runner
WORKDIR /environment
