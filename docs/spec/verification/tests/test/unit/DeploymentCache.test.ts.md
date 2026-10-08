# DeploymentCache.test.ts

Test file: [test/unit/DeploymentCache.test.ts](../../../../../../test/unit/DeploymentCache.test.ts)

## Overview

The suite exercises `resolveOrDeployShared` from the test-harness module
`test/harness/core/deploymentCache` — infrastructure that lets parallel test processes share one
deployed contract address through a marker file — against fresh `mkdtemp` cache directories with
stubbed `validate`/`deploy` callbacks and a real logger. The tests assert the cache contract at
the caller-visible level: a single deploy followed by cache hits for every later caller (deploy
counted once, `source` reported as `deployed` vs `cache`), concurrent first callers each receiving
a usable deployed value with the last write published for subsequent callers, redeployment when
the stored marker no longer validates (stale value replaced on disk), and a direct deploy when no
cache directory is configured. Oracles are the returned `{value, source}` pairs, deploy-call
counts, and the marker file's on-disk content. This is harness-only code with no implementation
source report under `docs/spec/implementation/source/`, so there is no Exercises target and
no assignable test ID pool; protocol behavior is entirely out of scope.

## Tests

- `deploys once and serves every later caller from the marker`: none
- `gives concurrent first callers a usable value each, then caches for the rest`: none
- `redeploys when the stored value no longer validates`: none
- `deploys directly when no cache dir is configured`: none
