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

For usage in this repository, install the Foundry version in `.forge-version`,
initialize the pinned Solidity dependencies, install local dependencies, and
build the SDK:
```shell
foundryup --install "$(cat .forge-version)"
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

Without filename overrides, the runner discovers `test/**/*.ts` for Mocha,
`test/**/*.sol` for Foundry and `test/browser/run-*.mjs` for the browser gates.
A repository may contain any of the tiers. Each tier filters candidates by file
type before parsing, including when a shared `--test-pattern` is supplied.

```shell
yarn test:parallel --forge-only     # only the forge tier
yarn test:parallel --no-forge       # Mocha tier
yarn test:parallel --browser-only   # only the browser gates
yarn test:parallel --no-browser     # Mocha and forge tiers
yarn test:parallel --forge-threads 2
yarn test:parallel --test-pattern 'V1/**' # filter every tier
```

Mocha tests are discovered from their TypeScript sources but run from the
compiled tree under `dist/` by default, so no test child or worker thread
transpiles anything, while `--enable-source-maps` keeps every stack trace on
the `.ts` lines. The distributed workers build that tree in their prepare step
(`yarn test:parallel:build`, a clean build). The local runner keeps it current
from a stamp the build writes: when only file contents changed it re-emits in
place without deleting anything, because a runner can itself be a task of an
outer run that is loading from the same tree; when a source was added, removed
or renamed it runs the clean build, so no compiled twin of a deleted file can
linger and run. Outside a project with that build script the runner falls back
to the sources. Two flags change the default:

```shell
yarn test:parallel --skip-build     # never refresh, use the dist tree as is
yarn test:parallel --source-tests   # run the .ts sources under ts-node instead
```

Each forge task uses one thread by default. `forge test` otherwise sizes its
thread pool from the logical core count, which inside a CPU-limited container is
still the host's count, so unpinned tasks oversubscribe the host. The runner
already parallelizes across tasks. Use `--forge-threads` to override the
default. `--e2e-only` selects the Mocha end-to-end tier and drops the forge and
browser tiers with it. Use `--mocha-test-pattern`, `--forge-test-pattern` or
`--browser-test-pattern` when only one tier needs a filename filter.

Forge tasks need no Hardhat node, so they take neither a warm slot nor a funded
account partition. Local runs build the contracts once before scheduling;
distributed runs rely on the worker's prepare script for that.

Forge tasks run through the Hardhat CLI like every other task. A forge task's
arguments invoke the `forge-test` Hardhat task in `tasks/forgeTest.ts`, which
shells out to `forge test --match-contract <contract> --threads <count>`,
streams its output through, and passes its exit code on. It does not depend on
the compile task, so no task recompiles.

Before discovery, projects defining `generate-enums` and `generate-artifacts`
run `yarn hardhat compile` and those two generators before building the TypeScript
test tree. Hardhat updates TypeChain for changed contracts; a missing TypeChain
index triggers `yarn hardhat typechain`. Unchanged generated output keeps its
modification time so an unchanged run reuses `dist`. Hardhat's existing cache decides which
contracts need recompiling. `--skip-build` and `--dry-run` skip this preflight.
The standalone `yarn compile` command still performs its full clean rebuild.

Worker preparation also lets Hardhat reuse its compile cache. Successful dependency
installation is checkpointed separately from compilation, so an interrupted build
can reuse it. When a run finishes normally while a worker is still preparing, cleanup
waits for preparation to finish and retain its caches. This can extend a cold run;
explicit cancellation and disconnected leases still stop without waiting for the build.
Hardhat supplies TypeScript-test artifacts and TypeChain bindings; Forge builds the
Solidity test contracts into its separate cache.

The indirection is what makes the tier work on a distributed worker: a worker
executes tasks with its own copy of the runner, taken from the checkout that
started `yarn test:parallel:server`, while only the project sources are synced
to it. `hardhat.config.ts` is a synced project source, so a task registered
there reaches every worker without any worker-side update.

```shell
yarn hardhat forge-test --match-contract '^UtilityFacetTest$'
```

### Browser tests

Each `test/browser/run-*.mjs` gate is one task. A gate boots a Vite server, its
own Hardhat node and one headless Chromium, then drives every scenario on a
single page, so splitting a gate per case would relaunch that stack per case.
Like forge tasks, gates need neither a warm slot nor a funded account partition,
and they reach the worker through a Hardhat task — `browser-test` in
`tasks/browserTest.ts`, which runs the gate with Node and passes its exit code
on.

The gates load `src` through Vite, so the tier needs only a typecheck of
`tsconfig.browser.json` (`yarn typecheck:browser`), not a build. Local runs
and distributed runs both perform it once before scheduling, and only when the
run holds a gate; distributed workers never run it in their prepare script.

```shell
yarn test:parallel --browser-only
yarn hardhat browser-test --script test/browser/run-p2p-webrtc-e2e.mjs
```

A gate needs the Chromium that Playwright ships with the version `yarn.lock`
resolves. Install it locally with `yarn playwright install chromium`; the
distributed runner image installs it during the image build. Playwright
launches Chromium without its own sandbox by default, so the container is the
isolation boundary. The container's `/dev/shm` is the default 64MB, so the image
declares `SCP_BROWSER_CONTAINED=1` and the gates keep Chromium's shared memory
in `/tmp` there.

An environment hands its worker a fresh `HOME`, and `pnpm install` never
downloads browsers, so a gate finds Chromium only through
`PLAYWRIGHT_BROWSERS_PATH`. The runner image sets it; a worker started with
`--execution-backend unsafe-host` points it at the host's own Playwright cache
unless the operator exported another path. A gate that cannot find the browser
says so and names the variable.

A worker runs tasks with the runner from its own checkout, so the browser tier
reaches it only after **the worker host updates that checkout, restarts
`yarn test:parallel:server`, and rebuilds its runner image**
(`yarn test:parallel:image`; the server refuses a stale image, and on restart
discards cached environments whose containers were created from another image). The browser tier
arrived with distributed protocol 14. The orchestrator still leases protocol 13
hosts and hands them only hardhat and forge tasks, so a pool can upgrade one
host at a time. A Mocha test file that launches Chromium carries
`// @distributed-requires: browser` in its leading comments, and its tests go
only to hosts that run the browser tier as well. When they are all that is left
and no connected worker has supported the browser runner for the discovery
window (`--discovery-timeout`), the run skips the browser tasks and those marked
Mocha tests with a warning that lists them (also written to the GitHub job
summary) instead of failing; CI's `browser` job runs the same gates inside the
runner image either way. A task whose attempt was lost with the only host that
could run it fails instead of being skipped.

A worker that leaves before it is given a task, whether its lease or workspace
setup fails, it refuses the requested resources, or its connection closes, is
retried, but not indefinitely: after three consecutive failures with the same
error the orchestrator retires that host for the rest of the run and logs the
error. Being given a task resets the count, and a different error starts a new
one. When every discovered host has been retired this way the run fails at once
with `All distributed workers failed the same way 3 times: <error>` instead of
redialing until the job times out; when some were instead quarantined before
running a task (for example after repeated workspace preparation errors), it
fails with `All distributed workers were quarantined before running a task`.

### Cost-aware scheduling

Both runners measure every test while it runs: peak memory of its process tree,
average CPU cores and duration. At the end of a run the orchestrator (or the
local runner) stores each test's latest measurement in the ignored
`.cache/test-costs.json`, updates the committed `test-costs.json` at the project
root (see below), and writes `logs/run-N/run-metrics.json` with how busy each
worker was, why it held tests back and when each test was first assigned.
Distributed `[startup]` logs show per-worker phase durations and elapsed time
from orchestrator startup: connection, lease wait, workspace negotiation,
transfer/preparation, worker boot/infrastructure provisioning, and first assignment.
Workspace negotiation reports changed/deleted file counts and transfer size.
Phase timings are also saved under each worker's `startup` in `run-metrics.json`;
local compilation and bundling before orchestrator startup are outside that clock.

Cost scheduling is the default. With `--schedule fifo`, measurements are only
recorded. On Linux,
fifo's memory admission now reads running tests' memory from `/proc`, where it
used to fall back to whole-host memory and a fixed 2 GB per test, so containers
may admit more tests than before.

With `--schedule cost` the runner uses them: browser-only and longest tests
start first, and a busy worker is handed only a test whose predicted CPU and
memory still fit beside everything it runs. Every test start waits the configured
scheduler interval before another test can start, including known-cost tests and
tests that finish within the interval.
After the interval has elapsed, a completion can trigger immediate admission.
Failed attempts cannot lower the CPU estimate used for subsequent scheduling;
a successful measurement can lower it again.
`--cpu-limit 6` sets a distributed worker’s predicted CPU budget to six cores,
including values above its detected available cores. It does not impose a container CPU quota.
For example, twelve tests predicted to use 0.5 cores each fit this CPU budget,
provided the worker’s `--workers` cap permits twelve and memory/live load allow it.
The server’s CPU limit is a default; an orchestrator can request a higher value.
An idle worker still accepts one oversized test so it can make progress.
The `--workers` cap still applies, and so does `--target-load`: machine CPU at
or above `min(--target-load, 0.95)` holds new tests. Hold counts in
`run-metrics.json` include tests a worker was refused because they did not fit
its budget; a distributed run also logs each refusal in that worker's
infrastructure log and totals them in its summary line.

```shell
yarn test:parallel --schedule cost --workers 30
yarn test:parallel:distributed --schedule cost
yarn test:parallel --cost-cache /tmp/costs.json  # another cache file
yarn test:parallel:distributed --schedule cost --cost-cache-read-only  # CI
```

Memory admission leaves 20% of the effective RAM limit as headroom. It adds
predicted growth of running tests to current process-tree usage, including shared
infrastructure. On bounded cgroup v2 workers it also checks container-wide usage
and uses the smaller of the configured and container limits. Busy admission
subtracts only inactive file cache. With no tests running, the memory hold also
excludes active file cache so reclaimable pages cannot prevent idle progress;
process-tree RSS, anonymous/shared memory and kernel memory remain counted.
Raising `--cpu-limit`
does not raise this RAM budget. Predictions remain estimates, not a guarantee
against an individual test exceeding its recorded peak.

Each of a test's duration, cores and memory comes from, first match wins: an
override, this run's measurement, the committed `test-costs.json`, the average
of finished tests from the same file, then one default (30 s, 1 core, 2 GB).
The committed costs and overrides are orchestrator-only metadata and are excluded
from worker source bundles, so updating them does not trigger worker preparation.
`.cache/test-costs.json` is only a record of the latest run; scheduling never
reads it. A measurement without cores or memory (from an older worker) leaves
those to the later sources. Every attempt whose result the run keeps is measured
(a speculative copy that finishes after its test settled only when it fails the
test; a redundant copy never); an attempt that starved is recorded with 50% more
cores and memory, so its retry is admitted as more expensive, and the run keeps
its last attempt's measurement.

`test-costs.json` and `test-costs.overrides.json` live at the project root, so
another project using this runner keeps its own. A run that writes the cache
adds a test's entry to `test-costs.json` only when it is new. Existing entries
stay unchanged on ordinary runs, regardless of CPU or memory drift. A final
starvation sample still updates the entry with the existing 50% CPU and memory
inflation and a `starved: true` marker. The next successful, non-starved run
with complete measurements replaces that temporary baseline and clears the marker.
`.cache/test-costs.json` is atomically replaced with only the latest completed
run's measurements; tests absent from that run and older measurements are not merged in.
The committed `test-costs.json` still preserves existing baselines as described above.
At the end of a completed run, deleted tests are removed from both files by
checking their source definitions, independently of grep, tier, and optional-group
filters. Inactive tests and definitions that cannot be safely inspected are retained.
Interrupted and read-only runs do not prune costs.
Disable both writes
with `--cost-cache-read-only`: it schedules by the committed costs and writes
neither file. `yarn test:costs:snapshot` copies every test's latest measurement
from the cache into `test-costs.json` even for existing entries; it stops
without writing if the cache is missing or either file cannot be read.

To correct a test's cost by hand, add it to the optional
`test-costs.overrides.json`, keyed by
`runner|file|full title`, e.g.
`{ "hardhat|test/e2e/foo.test.ts|Foo does bar": { "rssGb": 4, "comment": "why" } }`;
the fields are `durationMs`, `cores` and `rssGb`, plus an optional string
`comment` that records why the cost is set by hand. An invalid overrides file fails the run
before anything is built, in either schedule. The defaults are placeholders in
`scripts/e2e-parallel/shared/constants.js`, to be tuned from
`run-metrics.json`. Workers on protocol 13/14 keep the old admission.

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
`scripts/e2e-parallel/distributed/runner-image.Dockerfile` with
`yarn test:parallel:image`, which labels the image with the Dockerfile's
revision and prints its immutable local image ID. Configure that ID or a
published repository digest of such an image:

```shell
yarn
yarn test:parallel:image
export SCP_TEST_RUNNER_IMAGE='sha256:<local-image-id>'
yarn test:parallel:server --name worker-one
```

The server refuses to start when the configured image was built from another
revision of the Dockerfile than its checkout carries, or without the label: the
distributed protocol version covers the runner code, not the image, so a host
that updated its checkout without rebuilding would otherwise accept tasks its
image cannot run. Rebuild the image after every checkout update that changes
the Dockerfile.

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

Each server's startup values provide per-run defaults. The orchestrator may
request higher or lower CPU budgets and worker counts. Memory, disk, process,
slot, load and interval settings retain their server ceilings: an oversized
request for one of those settings is rejected before creating a container;
it is never silently clamped. A retained container updates
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
capacity block and labels the worker's advertised default.
Both `-w` and `--cpu-limit` may exceed worker defaults. CPU budgets may also
exceed detected cores. Memory and live-load admission still apply; chain tests
wait when all 40 funded account partitions are occupied. Workers need this
runner update once; subsequent experiments need only orchestrator flags.

```shell
yarn test:parallel:distributed --schedule cost -w 16 --cpu-limit 12 --cost-cache-read-only
yarn test:parallel:distributed --schedule fifo -w 16 --cost-cache-read-only
```

The source archive contains tracked and non-ignored files from the test
repository and every recursive `link:` or `file:` dependency. Their relative
filesystem layout is preserved, so links such as
`poker -> ../state-channels-plus` resolve after extraction. The host forwards
archive chunks as data and never extracts them. The trusted guest runner
verifies and extracts source, installs each repository with pnpm, provisions test
infrastructure, and executes every task inside the same isolated environment.

#### Open security findings

These findings come from Codex Security scan
`b16b8056-1a2e-47ad-b510-34ef96ce1d0b`, reassessed statically on 2026-09-30.
They are confirmed from source but not reproduced at runtime, and not fixed.

- **Docker workload filtering omits worker-host services** (low; Codex
  `csf_6eed22aa96514ee57ddf2190`). The Linux backend installs its host-CIDR
  deny rules only in `DOCKER-USER`
  ([egressPolicy.js:88-112](scripts/e2e-parallel/distributed/egressPolicy.js#L88-L112),
  [isolatedEnvironment.js:498-507](scripts/e2e-parallel/distributed/isolatedEnvironment.js#L498-L507)).
  Container-to-host traffic uses `INPUT`, so a guest can reach a listening
  worker-host service unless a separate `INPUT` policy blocks it. This breaks
  the worker-host blocking promised above. Forwarded private traffic is still
  filtered, and Docker Desktop is weaker by design.
  - Fix: filter the container-to-host `INPUT` path as well as forwarded egress.
  - Regression: with a listening sentinel on the bridge host, guest TCP is
    denied; policy setup, container reuse and cleanup cover both paths.
- **Guest log output can exhaust the worker supervisor** (medium; Codex
  `csf_a62e0fe543a39012e6a874cf`). Guest preparation output reaches
  independently scheduled handlers, and each outbound send allocates its
  buffer before it joins an unbounded write chain
  ([server.js:372-375](scripts/e2e-parallel/distributed/server.js#L372-L375),
  [server.js:1287-1293](scripts/e2e-parallel/distributed/server.js#L1287-L1293),
  [protocol.js:265-289](scripts/e2e-parallel/distributed/protocol.js#L265-L289)).
  An admitted orchestrator that stops reading while it keeps heartbeats alive
  grows supervisor memory outside the guest limits. Authentication, frame
  limits and guest memory limits remain.
  - Fix: bound queued bytes per connection and apply backpressure to guest
    output, or stop an over-budget producer; bound stalled output separately
    from the inbound heartbeat.
  - Regression: a slow-reading orchestrator with continuous preparation output
    stays within the queue budget, and other worker leases are unaffected.

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

Add `--review-codex [model]` (default `gpt-6-astra`) or `--review-claude [model]`
(default `claude-opus-5-5`) to the same worker command to also offer PR reviews;
`--review-effort <effort>` sets the reasoning effort (default `low`). These are
worker-side, so changing them needs a worker restart, not a push. The worker reuses its identity, pool secret and authorization policy, announces the
review discovery topics, and stores review state under `<work-root>/review/`.
The selected CLI (`codex` or `claude`) must be on PATH and logged in as the
worker user. No separate
review-server command or configuration file is needed. See
[PR review setup](docs/pr-review-bot.md).

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
`SCP_TEST_POOL_SECRET` as this seed. Distributed test jobs that share this identity
are serialized across the repository with `queue: max`; unrelated spec/browser
jobs and the independent review workflow do not wait for that queue. Reviews
finish their active run and retain only the newest pending run per PR; superseded
reviews stay on the server without publication. Host-lock process coverage runs as
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

The orchestrator leases worker hosts on any distributed protocol from the
minimum it still supports up to its own (`MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL`
and `DISTRIBUTED_PROTOCOL_VERSION` in `protocol.js`), and schedules on each host
only the tasks whose runner, and every runner their test file requires, its
protocol knows. A host outside that range is rejected
before test execution with an update or rebase instruction. A worker host and
its isolated guest must still match exactly, since both run the host's own
checkout.

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

## Automated PR review

See the [persistent PR review service guide](docs/pr-review-bot.md) for setup, account and host prerequisites, CI ownership, recovery and acceptance.

### Optional test groups

Normal parallel runs omit `e2eParallel*.test.*` runner self-tests and browser
checks (both browser gates and Mocha files marked `@distributed-requires: browser`).
Enable them explicitly, including when using `--grep`:

```shell
yarn test:parallel:distributed --test-parallel-script
yarn test:parallel:distributed --test-browser
yarn test:parallel:distributed --test-parallel-script --test-browser
```

CI passes both flags for the full test gate. `--browser-only` still selects only
browser gates. `--e2e-only` retains its existing tier restrictions.
