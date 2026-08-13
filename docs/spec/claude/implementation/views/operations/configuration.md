# Protocol Configuration Semantics — Implementation

> **Specification subject:** [specification/runtime/configuration.md](../../../specification/runtime/configuration.md)

> **Agent authoring status:** Current configuration behavior assembled; completeness requires engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

## Implementation overview

**Status:** Partial; configuration loading and operational options exist, but complete compatibility,
safe-bound, provenance, and secret-redaction conformance requires audit.

### Specification adherence

The implementation defines precedence, environment coercion, transports, runtime modes, and operational
commands corresponding to the neutral configuration subject.

### Specification contradiction

No contradiction is asserted without source audit.

### Missing

Cross-participant compatibility negotiation and production-safe bound validation are not demonstrated.
**Required resolution:** audit each configuration owner, define unit permutations, and map startup-level tests.

## Assumptions and constraints

Configuration is evaluated before participant startup. Environment values are strings, local operators are
trusted to supply secrets, and development defaults are not evidence of production suitability.

## System design

> **Status:** Draft.
> **Scope:** Runtime configuration of an SDK instance (sources, precedence, full field reference)
> and the build/test/format workflow. Verified against
> [src/utils/config.ts](../../../../../../src/utils/config.ts#L1) and
> [package.json](../../../../../../package.json).

## Contents

- [The configuration file](#1-the-configuration-file)
- [Precedence and environment coercion](#2-precedence-and-environment-coercion)
- [Configuration reference](#3-configuration-reference)
- [Choosing a transport](#4-choosing-a-transport)
- [Local vs. networked operation](#5-local-vs-networked-operation)
- [Build, test, and format workflow](#6-build-test-and-format-workflow)
- [Implementation test plan](#implementation-test-plan)
- [Implementation traceability](#implementation-traceability)
- [Test traceability](#test-traceability)
- [Future Work](#future-work)

Configuration is resolved once per process, during `p2pSetup`
([../sdk/architecture.md](../architecture/sdk/architecture.md)), by `createConfig` in
[src/utils/config.ts](../../../../../../src/utils/config.ts#L1). The result is a process-lifespan singleton
(`config`) that every component reads; only the config module itself mutates it.

## 1. The configuration file

Create a `peer3.config.json` or `peer3.config.ts` in the root of your project, next to
`package.json`. The SDK imports it statically in
[src/utils/config.ts](../../../../../../src/utils/config.ts#L1)
(`import peer3Config from "../../peer3.config"`); this repository ships a
[peer3.config.ts](../../../../../../peer3.config.ts#L1) at its root. A minimal file only needs the provider
URL; every other field falls back to a built-in default:

```json
{
    "PROVIDER_URL": "http://localhost:8545"
}
```

`createConfig` also accepts a `configFileOverride` argument that replaces the file's contents at
the same (file-level) precedence — the test harness uses this to supply its own base config while
still letting environment variables and explicit overrides win.

## 2. Precedence and environment coercion

`createConfig` merges four sources; later sources override earlier ones:

> defaults ≺ `peer3.config` file ≺ `process.env` ≺ explicit overrides (the `config` option of
> `p2pSetup`)

Environment variables are only applied in a Node runtime (`isNodeRuntime()`); in the browser they
are ignored. Only keys present in the default config are read from the environment, and values are
coerced by the type of the field's default:

- **Booleans** accept `true`/`1`/`yes`/`y`/`on` and `false`/`0`/`no`/`n`/`off`
  (case-insensitive, trimmed). Anything else is ignored.
- **Arrays** (string arrays) accept a JSON array of strings
  (`HOLEPUNCH_RELAYER_URLS='["wss://a","wss://b"]'`) or a comma/space-separated list.
- **Numbers** must parse to a finite number.
- **Strings** are taken as-is.

An unparseable value is ignored, so the lower-precedence source's value stays in effect — it is
not an error.

## 3. Configuration reference

All fields with their defaults, from `DEFAULT_CONFIG` in
[src/utils/config.ts](../../../../../../src/utils/config.ts#L1):

| Field                                      | Type       | Default                 | Purpose                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDER_URL`                             | `string`   | `http://localhost:8545` | JSON-RPC endpoint of the chain hosting the `StateChannelManager`. **This endpoint is a trust dependency**: the client observes chain state and events through it, and correct operation is not guaranteed if every available endpoint is unavailable or dishonest — see [../security/trust-model.md](../../../specification/security/trust-model.md). |
| `DEBUG_STATE_MANAGER`                      | `boolean`  | `false`                 | Verbose logging for the StateManager.                                                                                                                                                                                                                                                                                                                 |
| `DEBUG_DISPUTE_HANDLER`                    | `boolean`  | `false`                 | Verbose logging for the dispute/fraud-proof path.                                                                                                                                                                                                                                                                                                     |
| `DEBUG_P2P_MANAGER`                        | `boolean`  | `false`                 | Verbose logging for the P2PManager and peer connections.                                                                                                                                                                                                                                                                                              |
| `DEBUG_RPC`                                | `boolean`  | `false`                 | Verbose logging for the RPC layer.                                                                                                                                                                                                                                                                                                                    |
| `DEBUG_CHANNEL_CONTRACT`                   | `boolean`  | `false`                 | Verbose logging for on-chain contract interactions.                                                                                                                                                                                                                                                                                                   |
| `DEBUG_LOCAL_TRANSPORT`                    | `boolean`  | `false`                 | Verbose logging for the local (WebSocket) test transport.                                                                                                                                                                                                                                                                                             |
| `LOG_LEVEL`                                | `string`   | `info`                  | Global log verbosity (`warn`, `info`, `debug`, `verbose`).                                                                                                                                                                                                                                                                                            |
| `LOG_SKIP_WRITING`                         | `boolean`  | `false`                 | Suppress writing logs to disk.                                                                                                                                                                                                                                                                                                                        |
| `LOG_EXCLUDE_TAGS`                         | `string`   | `""`                    | Comma-separated log tags to exclude.                                                                                                                                                                                                                                                                                                                  |
| `EXCLUDE_LOG_TAGS`                         | `string`   | `""`                    | Alias field with the same purpose as `LOG_EXCLUDE_TAGS`; both exist as separate config keys.                                                                                                                                                                                                                                                          |
| `HOLEPUNCH_RELAYER_URLS`                   | `string[]` | `[]`                    | Relayer endpoints for the Holepunch transport.                                                                                                                                                                                                                                                                                                        |
| `LOCAL_DISCOVERY_REGISTRY_URL`             | `string`   | `""`                    | URL of a local peer-discovery registry, used for local/test discovery instead of Holepunch.                                                                                                                                                                                                                                                           |
| `VM_DEDICATED_THREAD`                      | `boolean`  | `false`                 | Run the local EVM in a dedicated thread.                                                                                                                                                                                                                                                                                                              |
| `RUN_SDK_IN_THREAD`                        | `boolean`  | `false`                 | Run the SDK runtime host in a dedicated worker thread ([../sdk/architecture.md](../architecture/sdk/architecture.md)).                                                                                                                                                                                                                                |
| `EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS` | `number`   | `0`                     | `>0` enables the logger event-loop monitor (throws past this many seconds) and, as a side effect, the `##E2E_TIMING##` diagnostics the parallel runner parses. Tests set `1`; `0` disables it.                                                                                                                                                        |
| `SIGNER_RECOVERY_CACHE_MAX`                | `number`   | `100000`                | Max entries in the per-thread signer-recovery cache (message + signature → address); bounds memory, evicts oldest.                                                                                                                                                                                                                                    |
| `CRASH_LOG_UPLOAD_ENDPOINT`                | `string`   | `""`                    | Non-empty enables crash-log upload to this endpoint.                                                                                                                                                                                                                                                                                                  |
| `CRASH_LOG_API_TOKEN`                      | `string`   | `""`                    | Auth token for crash-log upload.                                                                                                                                                                                                                                                                                                                      |
| `CRASH_LOG_MAX_SIZE_MB`                    | `number`   | `10`                    | Cap on crash-log upload size.                                                                                                                                                                                                                                                                                                                         |

> **Secrets.** `CRASH_LOG_API_TOKEN` and any credentials embedded in `PROVIDER_URL` are secrets.
> Supply them via environment variables (§2); they MUST NOT be committed in a checked-in
> `peer3.config.json`/`.ts`.

## 4. Choosing a transport

Connectivity is pluggable behind [ATransport](../../../../../../src/transport/ATransport.ts#L12); the
components involved are described in [../sdk/components.md](../architecture/sdk/components.md). The
`TransportType` enum ([src/transport/TransportType.ts](../../../../../../src/transport/TransportType.ts#L1))
has three values — `HOLEPUNCH`, `WEBRTC`, `LOOPBACK` — and the P2PManager defaults to preferring
`HOLEPUNCH`; peers negotiate a common transport during the handshake.

| Transport           | Select for                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Holepunch (default) | NAT-traversing p2p between independent hosts. Configure relayers via `HOLEPUNCH_RELAYER_URLS`.                                                                                                                                                        |
| WebRTC              | Browser-to-browser connectivity.                                                                                                                                                                                                                      |
| Loopback            | Trusted in-process "send to self" delivery (a node calling its own RPC); never tracked as a peer.                                                                                                                                                     |
| Local transport     | WebSocket-based transport for local/test runs between processes on one machine ([src/transport/LocalTransport.ts](../../../../../../src/transport/LocalTransport.ts#L16)); paired with the local discovery registry (`LOCAL_DISCOVERY_REGISTRY_URL`). |

Note that any transport only affects the p2p path; the topology is a full mesh either way, with
the partition-size limits described in [../security/trust-model.md](../../../specification/security/trust-model.md).

## 5. Local vs. networked operation

- **Local / test.** Point `PROVIDER_URL` at a local chain (the Hardhat node started by
  `yarn infra:hardhat-node`, default `http://localhost:8545`), use the local transport, and start
  the local discovery registry with `yarn infra:local-discovery`. This is how the test suite runs
  and the fastest way to exercise the full lifecycle on one machine.
- **Networked.** Point `PROVIDER_URL` at the chain hosting your deployed `StateChannelManager` and
  use a real transport (Holepunch or WebRTC). Each participant runs its own SDK instance; only
  opening, disputes, and settlement touch the chain
  ([../protocol/lifecycle.md](../../../specification/settlement/lifecycle.md)).

## 6. Build, test, and format workflow

Script names verified against [package.json](../../../../../../package.json):

The parallel and distributed runners rely on the runtime host/client split
([../sdk/architecture.md](../architecture/sdk/architecture.md)) and the local infrastructure above. The
repository's `AGENTS.md` files carry the binding workflow rules (canonical gate, log-directory
behavior, test-timeout policy) for contributors and agents.

### Implementation test plan

These are concrete component-level tests required by the implementation obligations in this document. Exercise public boundaries with real domain values and collaborators. Every listed permutation is required unless an engineer records why it is not applicable.

| Plan item      | Requirement / invariant | Setup and stimulus                                                                                                      | Expected result                                                                                                                                                    | Required permutations                                                                                                                                                                                                                               |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-CFG-1.T1` | `REQ-CFG-1`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Read the resulting public `config` after `createConfig`; every field equals the highest-precedence valid source.                                                   | `REQ-CFG-1.T1.P1` — default only<br>`REQ-CFG-1.T1.P2` — file over default<br>`REQ-CFG-1.T1.P3` — environment over file<br>`REQ-CFG-1.T1.P4` — explicit override over environment<br>`REQ-CFG-1.T1.P5` — unrelated keys unchanged                    |
| `REQ-CFG-2.T1` | `REQ-CFG-2`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Boolean, number, array, and string values have the documented runtime types; malformed values leave the previous value intact.                                     | `REQ-CFG-2.T1.P1` — every accepted boolean spelling and case<br>`REQ-CFG-2.T1.P2` — finite/non-finite number<br>`REQ-CFG-2.T1.P3` — JSON and delimited arrays<br>`REQ-CFG-2.T1.P4` — malformed JSON<br>`REQ-CFG-2.T1.P5` — empty and unknown values |
| `REQ-CFG-3.T1` | `REQ-CFG-3`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Identical environment-like input affects the Node result only; browser configuration remains file/override based.                                                  | `REQ-CFG-3.T1.P1` — Node<br>`REQ-CFG-3.T1.P2` — browser<br>`REQ-CFG-3.T1.P3` — worker-host startup<br>`REQ-CFG-3.T1.P4` — explicit override in both runtimes                                                                                        |
| `REQ-CFG-4.T1` | `REQ-CFG-4`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Components in one initialized runtime observe the same resolved values; later ambient environment mutation does not silently produce per-component configurations. | `REQ-CFG-4.T1.P1` — main-thread runtime<br>`REQ-CFG-4.T1.P2` — dedicated runtime thread<br>`REQ-CFG-4.T1.P3` — repeated component reads<br>`REQ-CFG-4.T1.P4` — fresh runtime initialization                                                         |
| `REQ-CFG-5.T1` | `REQ-CFG-5`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Defaults contain no credential; environment/explicit values reach the intended configuration field without appearing in repository configuration.                  | `REQ-CFG-5.T1.P1` — crash-log token<br>`REQ-CFG-5.T1.P2` — credential-bearing provider URL<br>`REQ-CFG-5.T1.P3` — absent secret<br>`REQ-CFG-5.T1.P4` — explicit override                                                                            |

## Implementation traceability

| Requirement / invariant | Statement                                                                                                               | Implementation status | Implementation evidence                                                                                                   | Gap / divergence |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `REQ-CFG-1`             | Configuration precedence is defaults, file, Node environment, then explicit overrides.                                  | Covered               | [src/utils/config.ts](../../../../../../src/utils/config.ts#L1)                                                           | None.            |
| `REQ-CFG-2`             | Supported environment values are coerced by the default field type; invalid values preserve the lower-precedence value. | Covered               | [src/utils/config.ts](../../../../../../src/utils/config.ts#L1)                                                           | None.            |
| `REQ-CFG-3`             | Environment configuration applies only in Node runtimes and is ignored by the browser build.                            | Covered               | [src/utils/config.ts](../../../../../../src/utils/config.ts#L1)                                                           | None.            |
| `REQ-CFG-4`             | One resolved configuration is shared for the initialized process/runtime-host lifetime.                                 | Covered               | [src/utils/config.ts](../../../../../../src/utils/config.ts#L1); initialization call sites require a precise source audit | None.            |
| `REQ-CFG-5`             | Checked-in defaults contain no secrets; secret-bearing values are supplied at runtime.                                  | Covered               | [src/utils/config.ts](../../../../../../src/utils/config.ts#L1), [peer3.config.ts](../../../../../../peer3.config.ts#L1)  | None.            |

## System integration test plan

| Integration test ID                                               | Specification IDs                                              | Specification test IDs                | Setup and stimulus                                                                                   | Expected result                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="integration-test-config-1"></a>`INTEGRATION-TEST-CONFIG-1` | `INV-CONFIG-1`, `REQ-CONFIG-1`, `REQ-CONFIG-2`, `REQ-CONFIG-3` | All configuration specification tests | Start the complete participant with each effective configuration and conflicting source combination. | Startup uses one typed compatible configuration or fails before protocol work without exposing secrets. | <a id="integration-test-config-1.p1"></a>`INTEGRATION-TEST-CONFIG-1.P1` — valid sources/precedence; <a id="integration-test-config-1.p2"></a>`INTEGRATION-TEST-CONFIG-1.P2` — invalid/mismatched/boundary values; <a id="integration-test-config-1.p3"></a>`INTEGRATION-TEST-CONFIG-1.P3` — secret diagnostics and restart. |

## Source inventory

| Source file | Specification IDs |
| ----------- | ----------------- |

The configuration source owners and their unit plans require consolidation from the design above.

## Conformance traceability

| Requirement / invariant | Implementation status | Implementation evidence                                     | Gap / divergence                                 |
| ----------------------- | --------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `INV-CONFIG-1`          | Covered               | Configuration loaders and effective options described above | Exact deterministic resolution evidence pending. |
| `REQ-CONFIG-1`          | Partial               | Precedence and environment coercion described above         | Provenance and redaction audit pending.          |
| `REQ-CONFIG-2`          | Partial               | Chain/transport/runtime options described above             | Complete compatibility gate not demonstrated.    |
| `REQ-CONFIG-3`          | Partial               | Typed options and resource settings described above         | Safe-bound validation not fully defined.         |
