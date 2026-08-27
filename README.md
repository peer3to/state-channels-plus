# Peer3 - State Channels Plus

This is an SDK for creating scalable and resilient client side peer-to-peer (p2p) state channels for arbitrary state machines with shared security inherited from a distributed ledger (blockchain).

The repository currently holds a Minimal Feature Set (MFS) as part of our [grant agreement](https://github.com/w3f/Grants-Program/pull/2350) with the Web3 Foundation.

We recommend waiting for the Full Feature Set before using it in production.

## Table of Contents
- [Peer3 - State Channels Plus](#peer3---state-channels-plus)
  - [Table of Contents](#table-of-contents)
  - [Videos](#videos)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
  - [Examples](#examples)
  - [Configuration](#configuration)
  - [Run Tests](#run-tests)
  - [Code Formatting](#code-formatting)
    - [Available Commands](#available-commands)
    - [Automatic Formatting](#automatic-formatting)
  - [Contact](#contact)
- [License](#license)

## Videos
- Demo - https://www.youtube.com/watch?v=W_CWPOezjU8
- Tech Explanation - https://www.youtube.com/watch?v=RtjiyDDhvWA
- Peer3 Intro - https://www.youtube.com/watch?v=GnRPe6ziKpI

## Installation

For usage in other projects, install from npm:
```shell
yarn add @peer3/state-channels-plus
```

For usage in this repository, install Foundry `v1.2.3`, initialize the pinned
Solidity dependencies, install local dependencies, and build the SDK:
```shell
foundryup --install v1.2.3
git submodule update --init --recursive
yarn && yarn build
```


## Getting Started
The SDK currently supports running EVM smart contracts (state machines).
We recommend watching our [tech explanation video](https://www.youtube.com/watch?v=RtjiyDDhvWA) to have a rough estimate how things work.

While you can do general (arbitrary) execution, the SDK requires the state machines to implement a base contract [AStateMachine](./contracts/V1/AStateMachine.sol).
The implemented contract executes p2p with shared security enforced by a blockchain, concretely by a StateChannelManager contract that extends [AStateChannelManager](./contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol).

The TypeScript part of the SDK currently builds on top of [ethers](https://github.com/ethers-io/ethers.js).

The SDK abstracts away most of the complexities of the system and is designed to have the same development experience as if the contracts were executing on-chain. It takes an ethers contract instance and enshrines it during [setup](./src/evm/EvmStateMachine.ts#L205). The enshrined contract has the same type and functionality as the original contract, but it executes p2p. The setup also wraps the ethers signer by giving it more functionality that's used within the system.

## Examples

[Tic-Tac-Toe](./examples/TicTacToe) - the code used in the [demo video](https://www.youtube.com/watch?v=W_CWPOezjU8)

<b style="color: yellow;">Note: The examples within this repository use the current version of the SDK(this repository) and not the remote package available on npm. This requires to install dependencies and build the SDK locally, before proceeding. </b>

## Configuration

Create a `peer3.config.json` file in the root of your project (next to `package.json`) with the following structure and set the values per your configuration:

```json
{
  "PROVIDER_URL": "http://localhost:8545",
  "DEBUG_STATE_MANAGER": false,
  "DEBUG_DISPUTE_HANDLER": false,
  "DEBUG_P2P_MANAGER": false,
  "DEBUG_RPC": false,
  "DEBUG_CHANNEL_CONTRACT": false,
  "DEBUG_LOCAL_TRANSPORT": false
}
```

```shell
yarn && yarn build
```

## Run Tests
Install local dependencies
```shell
yarn
```
Compile the contracts and run tests
```shell
yarn testc
```

### Foundry tests

Foundry test contracts are discovered alongside the Mocha tests and scheduled as
ordinary tasks, one task per test contract. A contract counts as a test contract
when it declares a `test`, `invariant`, or `statefulFuzz` function, so harness
and helper contracts sharing a file are left out.

Without filename overrides, the runner discovers `test/**/*.ts` for Mocha and
`test/**/*.sol` for Foundry. A repository may contain either tier or both. Each
tier filters candidates by file type before parsing, including when a shared
`--test-pattern` is supplied.

```shell
yarn test:parallel --forge-only     # only the forge tier
yarn test:parallel --no-forge       # only the Mocha tier
yarn test:parallel --forge-threads 2
yarn test:parallel --test-pattern 'V1/**' # filter both tiers
```

Each forge task uses one thread by default. `forge test` otherwise sizes its
thread pool from the logical core count, which inside a CPU-limited container is
still the host's count, so unpinned tasks oversubscribe the host. The runner
already parallelizes across tasks. Use `--forge-threads` to override the
default. `--e2e-only` selects the Mocha end-to-end tier and drops the forge tier
with it. Use `--mocha-test-pattern` or `--forge-test-pattern` when only one
tier needs a filename filter.

Forge tasks need no Hardhat node, so they take neither a warm slot nor a funded
account partition. Local runs build the contracts once before scheduling;
distributed runs rely on the worker's prepare script for that.

Forge tasks run through the Hardhat CLI like every other task. A forge task's
arguments invoke the `forge-test` Hardhat task in `tasks/forgeTest.ts`, which
shells out to `forge test --match-contract <contract> --threads <count>`,
streams its output through, and passes its exit code on. It does not depend on
the compile task, so no task recompiles.

The indirection is what makes the tier work on a distributed worker: a worker
executes tasks with its own copy of the runner, taken from the checkout that
started `yarn test:parallel:server`, while only the project sources are synced
to it. `hardhat.config.ts` is a synced project source, so a task registered
there reaches every worker without any worker-side update.

```shell
yarn hardhat forge-test --match-contract '^UtilityFacetTest$'
```

### Distributed parallel tests

The worker and orchestrator can run on different devices. They do not need a
direct IP address for each other when the default Hyperswarm DHT is reachable.
The orchestrator sends source files, not `node_modules` or local build output.

Put the same long, randomly generated secret in the ignored `.env` file on
every device:

```dotenv
SCP_TEST_POOL_SECRET=<the-same-random-secret-on-every-device>
```

Both runner entry points load `.env` automatically. On a manually provisioned
worker, install dependencies and build the runner image from
`scripts/e2e-parallel/distributed/runner-image.Dockerfile` with a digest-pinned
`NODE_IMAGE`. Configure either its immutable local image ID or a published
repository digest:

```shell
yarn
export SCP_TEST_RUNNER_IMAGE='sha256:<local-image-id>'
yarn test:parallel:server --name worker-one
```

The Docker volume driver must enforce the `size` option. The Linux service
account also needs permission to create Docker bridge networks and install the
per-environment `DOCKER-USER` firewall chain. The container runs as UID 10001
with a read-only base filesystem, all capabilities dropped, no new privileges,
no host networking, no Docker socket, and one quota-backed identity volume.
When user-namespace remapping is active, a fixed trusted initializer gives the
mapped runner user ownership of only that new volume. The initializer has no
network, a read-only root, and only `CHOWN`; it exits before any orchestrator
payload is accepted. Trusted runner files are then streamed into the volume as
the non-root runner user.
Linux blocks the worker host, link-local ranges, RFC1918 ranges, and each
`--deny-private-cidr` while allowing public egress. Docker Desktop retains the
filesystem/process/resource boundary but reports a reduced network guarantee;
do not use it as a shared hardened worker.

Each server's startup CPU, memory, disk, process, slot, worker, load, and
interval values are both its defaults and its current hard ceilings. An
orchestrator may request smaller per-run values with the corresponding
distributed command flags. The worker rejects an oversized request before
creating a container; it never silently clamps it. A retained container updates
its CPU, memory, and process limits before reuse. Its volume quota is fixed:
smaller disk requests are valid upper bounds, while a request above the volume's
original quota is rejected.
The worker uses `--execution-backend docker` by default and fails closed when
Docker is unavailable. Trusted local development can explicitly select the old
host behavior with `--execution-backend unsafe-host`; it is reported as having
no isolation. Unsafe-host workspaces remain identity-keyed under the selected
work root so restart recovery can reuse clean state and remove dirty state.

On the orchestrator device, start with a small smoke run from the project being
tested:

```shell
yarn test:parallel:distributed \
  --test-pattern 'scripts/e2eParallelDistributedE2E.test.ts' \
  --discovery-timeout 60000
```

`-w N` / `--workers N` requests at most `N` concurrent test processes from
each leased worker. The final summary prints that active limit in the existing
capacity block and labels the worker's advertised maximum.

The source archive contains tracked and non-ignored files from the test
repository and every recursive `link:` or `file:` dependency. Their relative
filesystem layout is preserved, so links such as
`poker -> ../state-channels-plus` resolve after extraction. The host forwards
archive chunks as data and never extracts them. The trusted guest runner
verifies and extracts source, installs each repository with pnpm, provisions test
infrastructure, and executes every task inside the same isolated environment.

#### Distributed storage and cleanup

`distributed-worker` is the default directory for worker-managed data, not a
separate process. When the server starts from this repository without an
explicit work root, its layout is:

```text
temp/distributed-worker/
├── environments/
│   └── <orchestrator-and-workspace-key>/
│       ├── workspace.lock
│       └── cache-allocation.json
└── host-state/
    ├── server.lock
    ├── authorization.json
    ├── audit/worker-audit.jsonl
    └── environments/<environment-key>.json
```

- The per-user runtime directory under the OS temporary directory contains the
  ordinary-mode host lock outside the worker root. Every server also owns
  `<work-root>/host-state/server.lock`. Shared-host mode skips only the global
  lock, so every concurrently running server must use a distinct resolved
  `--work-root`. Lock records contain a live PID and ownership token; a paused
  process never loses ownership, and stale-owner recovery cannot release a
  successor's lock.
- The host derives an environment key from the authenticated orchestrator
  transport key and workspace identity. Two identities with identical source
  never share a volume, package store, workspace, runner glue, logs, or locks.
- The Docker volume contains the trusted runner copy, source manifest,
  prepared workspace, package store, build output, infrastructure data, and
  attempt spool. The worker refreshes and verifies only the trusted runner on
  every start. Source, dependencies, and build artifacts persist between
  leases; transient logs and spools are pruned after selected evidence is
  acknowledged.
- Containers stop at lease end, so idle identities reserve disk only. The same
  identity restarts its stopped container and volume. Count and disk budgets
  evict only least-recently-used idle identities.
- A connection owns its allocation and workspace lock from reservation through
  cleanup. If the orchestrator disconnects during setup or transfer, the worker
  finishes stopping or destroying that environment before granting the next
  lease. A closed guest control pipe fails that environment, not the persistent
  worker server.
- Host metadata marks an environment dirty before preparation or execution and
  clears it only after Docker confirms stop/detach. Restart recovery stops
  orphans, retains clean idle caches, and destroys only a dirty identity.
- The host audit and authorization files are mode 0600 and are never mounted
  into a guest.

The orchestrator manifests the source once, then creates an isolated delta
archive only when a worker requests changed files. Each delta is removed after
that transfer. The temporary `distributed-transfer/` directory is deleted when
the distributed command finishes or fails. Canonical summaries and test logs
stay under `logs/run-N/`.

Use `--work-root <path>` to replace the default root completely:

```shell
yarn test:parallel:server \
  --name worker-one \
  --work-root /your/chosen/directory
```

All worker-managed files then live under `/your/chosen/directory`; nothing is
written to `temp/distributed-worker/`. Use an empty, writable directory on fast
local storage. `--allow-shared-host` requires an explicit `--work-root`; startup
locks that resolved root and rejects a second server with the exact conflicting
path. Give every worker on the shared host a distinct root. A defense-in-depth
workspace-lock error repeats this remedy if an older server bypasses startup
ownership. Real
distributed runs do not store package data in random OS temporary directories.
Unit tests may use OS temporary directories and remove them during teardown.

Workers continue to require the shared worker-set secret for discovery and
mutual authentication. They additionally authorize the authenticated Noise
transport public key. Start migration with unlisted orchestrators allowed (the
default). Print the persistent orchestrator public key with
`yarn distributed:identity`, then bootstrap it on a new worker by passing
that key to the worker server's repeatable `--admin-key` option. Admin
list/add/remove and policy operations apply to every worker discovered before
the deadline unless `--worker` selects one verified worker identity. Changes
apply only to future connection admission. A removed identity keeps its current
lease but cannot reconnect. Migration admissions record the full unlisted public
transport key in the host audit log so an operator can copy it into the
allowlist; ordinary allowlisted admissions record only the fingerprint.

The orchestrator normally stores its seed under
`temp/distributed-orchestrator`. Stateless CI machines must instead provide a
dedicated `SCP_TEST_ORCHESTRATOR_SEED` secret containing 64 lowercase hex
characters. The same seed produces the same transport identity on every run,
so each worker reuses one CI environment for the same workspace. Do not reuse
`SCP_TEST_POOL_SECRET` as this seed. CI runs that share this identity must be
serialized across the repository. GitHub keeps only one pending run in a
concurrency group, so a newer PR update can cancel an older queued run. Re-run
that cancelled check from the Actions tab. Host-lock process coverage runs as
part of the canonical distributed suite; CI does not start a separate local
host-lock job.

Use that persistent admin identity to discover workers and manage their
authorization stores over the authenticated distributed transport:

```shell
yarn distributed:identity
yarn distributed:admin workers --discovery-timeout 10000
yarn distributed:admin authorization-list --discovery-timeout 10000
yarn distributed:admin authorization-add --discovery-timeout 10000 \
  --public-key <orchestrator-public-key> --role orchestrator --note "CI runner"
yarn distributed:admin authorization-add --discovery-timeout 10000 \
  --public-key <admin-public-key> --role admin --note "backup operator"
yarn distributed:admin authorization-remove --discovery-timeout 10000 \
  --public-key <public-key>
yarn distributed:admin authorization-policy-set --discovery-timeout 10000 \
  --require-public-key on
yarn distributed:admin authorization-policy-set --discovery-timeout 10000 \
  --require-public-key off
```

Omitting `--worker` is the pool-wide form: the command waits for the discovery
deadline and reports one result per discovered worker. To target one worker,
pass `--worker <worker-public-key>`, using the full verified identity returned
by `workers`, not its short log fingerprint. These commands use
`SCP_TEST_POOL_SECRET` from the local `.env` and the same
`temp/distributed-orchestrator` identity as normal distributed runs.
The `workers` result includes `authorizationPolicy.publicKeyAuthorizationRequired`
for every discovered worker.

The shared secret is always required for discovery and mutual authentication.
On a new worker, any identity that proves knowledge of that secret is admitted
through migration mode. `authorization-policy-set --require-public-key on`
requires the authenticated orchestrator public key to be in the authorization
store; `off` restores migration admission. The setting is persisted under the
worker's host state and survives restarts. The startup flags
`--deny-unlisted-orchestrators` and `--allow-unlisted-orchestrators` explicitly
override the persisted setting. Bootstrap an admin and add every expected
orchestrator before enabling strict admission.

Inspect host-only audit state without entering a guest:

```shell
yarn test:parallel:server:admin audit-show --work-root /worker/root
yarn test:parallel:server:admin audit-export --work-root /worker/root --output ./audit.jsonl
yarn test:parallel:server:admin authorization-list --work-root /worker/root
```

The Docker boundary checks are explicit operator commands, outside normal test
discovery. Use a unique disposable work root. The full integration command is
Linux-only and additionally requires `SCP_DISPOSABLE_DOCKER_HOST=1`:

```shell
yarn test:parallel:docker:self-check --work-root /tmp/peer3-self-check
SCP_DISPOSABLE_DOCKER_HOST=1 yarn test:parallel:docker:integration --work-root /tmp/peer3-integration
yarn test:parallel:docker:benchmark --work-root /tmp/peer3-benchmark
```

After the smoke run, remove `--test-pattern` to run the whole suite. The worker
reports ready, busy, and queued states and remains announced for later runs.

Discovery always uses the public Hyperswarm network. There is no bootstrap
server or port to configure. Workers and orchestrators announce on separate
role-specific topics and look up the opposite role, so either side can establish
the authenticated connection without workers connecting to other workers.
While a run is active, both commands print their current stage: discovery,
connection, lease, source upload, pnpm progress, build output, test execution,
and cleanup. Use repeatable `--forward-env
<NAME>` flags for required test settings. The pool secret and the rest of the
orchestrator environment are never forwarded. Stop a server with SIGINT or
SIGTERM. Canonical task and failure logs remain on the orchestrator under
`logs/run-N/`, including `error_*.ansi` files and worker infrastructure
diagnostics. If a discovery server, Hardhat node, or isolated worker fails,
`logs/run-N/infra/` is retained with the process diagnostic and the affected
worker's streamed output. Infrastructure output is collected and retained when
any test fails. A fully successful run skips collection unless
`--keep-infra-logs` is set.

The distributed protocol version must match across the orchestrator, worker
host, and isolated guest. A mismatch is rejected before test execution with an
update or rebase instruction. After a protocol change, update and restart every
worker host before running branches that use the new protocol.

Dial diagnostics include the Noise handshake hash for each stream. Close lines
state whether this application closed the stream, Hyperswarm reported duplicate
deduplication, the transport failed, or no local application close was recorded.
Application duplicate handling runs only after authentication and keeps the
stream with the lower handshake hash.

## Code Formatting

This repository uses [Prettier](https://prettier.io/) for code formatting with configuration in `.prettierrc`. Formatting is automatically enforced using [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) to ensure consistent code style across all contributions.

### Available Commands

- Format all files: `yarn format`
- Check formatting without modifying files: `yarn format:check`

### Automatic Formatting

Files are automatically formatted when you commit changes. The pre-commit hook will run Prettier on staged files before they are committed, ensuring that all code in the repository follows the same formatting standards.

## Contact
- contact@peer3.to
- [Peer3 X](https://x.com/peer3_to)

# License
MIT
