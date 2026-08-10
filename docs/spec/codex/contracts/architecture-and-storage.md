# Contract architecture and storage

## Status and authority

This chapter defines deployment, routing, shared storage, and upgrade behavior. It separates the intended production architecture from the current V1 prototype.

## 1. Purpose

All contract modules need one coherent per-channel state while remaining small enough to deploy and replace safely. Architecture is a correctness concern because `delegatecall` combines code from one contract with storage from another. A bad selector, layout change, or initialization path can reinterpret every channel record.

## 2. Design decisions and rationale

### 2.1 Use selector routing, not a large forwarding proxy

The production manager must route `msg.sig` through a selector-to-facet table. The current proxy implements many forwarding functions directly and inherits large shared code, which puts the proxy above the runtime code-size limit. Selector routing keeps the dispatcher small and lets functionality be split by bounded responsibility.

### 2.2 Use versioned storage namespaces rooted at fixed slots

Each storage domain must use a named fixed root slot, for example a hash-derived V1 manager slot. A facet obtains a storage pointer through a library. New versions use new namespaces or append fields under a documented compatible layout. A compiler inheritance layout is not a stable upgrade protocol.

### 2.3 Keep old namespaces readable during migration

An upgrade may need to finish disputes created by old code. Removing access to old window or proof state can strand funds. A migration must either preserve old readers until all old state expires or convert each record with a resumable, idempotent migration.

### 2.4 Isolate pure helpers from storage-aware helpers

Signature recovery, ABI decoding, set operations, and hash calculations should be libraries when they do not need manager storage. Storage-aware functions remain in focused facets or storage libraries. Inheriting a broad `StateChannelCommon` into every facet duplicates runtime code and makes the dependency boundary unclear.

### 2.5 Application adapters are configured dependencies

The state machine and consumer are not arbitrary caller-selected addresses. Deployment or an authorized upgrade chooses them. The manager must not accept a per-call adapter because that would let callers choose balance and withdrawal semantics.

## 3. Boundary and responsibilities

The dispatcher owns selector routing and upgrade entry points. Facets own algorithms but no independent state. Storage libraries own slot calculation and field layout. The state machine owns temporary application state loaded and saved during a call. The consumer owns application assets and custom external effects.

`LocalDiamond` is not the production authority. It is a peer-local mirror that must reproduce manager-visible results from chain events. Local-only helper selectors must never be present in the production selector table.

## 4. Data model and owned state

### 4.1 Configuration state

| Field                 | Writer                                        | Reader                                | Required rule                                              |
| --------------------- | --------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `p2pTime`             | initializer or governed config upgrade        | timeout proof logic and SDK views     | nonzero bounded duration; unit is seconds                  |
| `agreementTime`       | initializer or governed config upgrade        | timeout deadline logic                | nonzero bounded duration                                   |
| `chainFallbackTime`   | initializer or governed config upgrade        | calldata fallback deadline logic      | nonzero bounded duration                                   |
| `evidenceTime`        | initializer or governed config upgrade        | evidence, kill, and challenge periods | changing it must not retroactively alter an open window    |
| `gasLimit`            | initializer or governed config upgrade        | state-machine execution safeguards    | must be below call gas and high enough for supported state |
| state-machine address | initializer or compatible application upgrade | all application transitions           | code must exist and implement the expected interface       |
| consumer address      | initializer or compatible application upgrade | asset and custom-message calls        | code must exist and be authorized for escrowed assets      |
| selector table        | Diamond cut authority                         | dispatcher                            | each selector maps to at most one facet                    |

The current constructor treats zero duration values as requests for defaults: P2P 15 seconds, agreement 5 seconds, chain fallback 30 seconds, evidence 30 seconds, and dispute execution gas 3,000,000. Production values are deployment parameters and must be recorded with the deployed address. Zero must not silently mean both “disabled” and “default.”

### 4.2 Per-channel authoritative state

| Domain              | Key                                   | Value and zero representation                                                  |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| adopted snapshot    | `channelId`                           | `StateSnapshot`; zero `forkId` means absent                                    |
| channel balance     | `channelId`                           | inbound head/height, outbound height, cumulative deposits and withdrawals      |
| inbound stream      | `(channelId, blockHash)`              | immutable `MessageBlock`; absent when timestamp is zero and messages are empty |
| calldata commitment | `(channelId, signer, forkId, height)` | commitment hash; zero means unused                                             |
| dispute state       | `channelId`                           | slash log, fork-to-window map, list of allocated disputed forks                |
| dispute throttle    | `(channelId, disputer)`               | earliest next upload timestamp; zero means never uploaded                      |

### 4.3 Derived state

The following values are not stored as separate authorities:

- snapshot participants come from the adopted snapshot;
- pending participants are JOIN messages between the adopted inbound head and the current on-chain inbound head;
- eligible participants are snapshot participants union pending participants minus on-chain slashes;
- the on-chain threshold set uses the same union and subtraction;
- a fork is disputed when its window has a nonzero creation timestamp;
- window phase is derived from evidence and reduction timestamps.

Derived set operations use address equality and remove duplicates. Participant order remains significant where the application or signature array uses it; set membership must not silently reorder data later hashed into a commitment.

## 5. Inputs and preconditions

### 5.1 Deployment

Deployment must provide nonzero, code-bearing facet, state-machine, and consumer addresses. Every required selector must be installed exactly once. The initializer must run once and write a version marker before any channel operation can execute.

The deployed runtime size of the dispatcher and every facet must be at most 24,576 bytes. This check uses the production compiler, optimizer, metadata, and linked-library settings.

### 5.2 Upgrade

An upgrade proposal must include:

1. selectors added, replaced, and removed;
2. old and new facet code hashes;
3. storage namespaces and layout diff;
4. initializer calldata and its idempotency rule;
5. supported in-flight channel and dispute states;
6. rollback procedure;
7. test evidence from an upgraded copy of production-like storage.

The upgrade caller must pass the configured authorization policy. A facet replacement that changes a normative encoding, timer meaning, or proof rule is a protocol version change, not a routine implementation patch.

## 6. Processing algorithm

### 6.1 Dispatch

1. Read `msg.sig` from calldata.
2. Resolve the facet from the selector table.
3. Revert with an unknown-selector error if no facet is registered.
4. Delegate the full calldata and available gas to the facet.
5. Return or revert with the exact returndata.

The dispatcher must not fall back to an application consumer for an unknown protocol selector. Application calls need an explicit namespaced entry point or an explicitly registered consumer selector. Silent consumer fallback can turn selector mistakes into asset-affecting calls.

### 6.2 Storage access

1. A storage library computes its constant root slot.
2. Assembly assigns that slot to a typed storage struct.
3. Facets read or write only declared fields in that namespace.
4. Cross-namespace invariants are updated in one transaction or through a versioned migration step.

### 6.3 Upgrade execution

1. Verify authorization and proposal identity.
2. Check that every replacement target currently matches the expected old facet.
3. Apply selector changes atomically.
4. Call the initializer by `delegatecall` if one is present.
5. Check the initializer version marker and required postconditions.
6. Emit a complete cut event and a protocol-version event.

Any failure reverts the entire cut.

## 7. Outputs and postconditions

A successful deployment exposes the complete interface, initialized config, and empty channel state. A successful upgrade exposes the new selector mapping while preserving all unaffected storage bytes and the ability to resolve supported old records.

Events must make deployment config and every later selector change independently auditable.

## 8. Invariants

- **ARCH-INV-1:** one selector resolves to zero or one facet, never multiple facets.
- **ARCH-INV-2:** no external caller can directly execute a facet in a way that mutates authoritative manager storage.
- **ARCH-INV-3:** a facet reads the same namespace and layout version against which it was compiled.
- **ARCH-INV-4:** initialization for a version succeeds at most once.
- **ARCH-INV-5:** an upgrade is atomic across selector changes and initialization.
- **ARCH-INV-6:** every deployed runtime is within the target-chain size limit.
- **ARCH-INV-7:** local mirror helpers cannot be reached through the production dispatcher.
- **ARCH-INV-8:** config changes do not change the deadline of a window that already recorded its phase timestamps.

## 9. Ordering, concurrency, and atomicity

Selector changes and initialization occur in one transaction. Channel operations submitted before an upgrade but included after it execute against the new code. Governance must account for this mempool race with activation delay, pausing, or explicit protocol-version arguments on sensitive calls.

A record migration must be resumable because one transaction may not fit all channels. Each per-channel migration uses a version marker and is idempotent. Operations on an unmigrated record either invoke a bounded lazy migration or revert with a clear migration-required error.

## 10. Trust and security assumptions

The upgrade authority can replace all protocol logic and is therefore fully trusted unless constrained by immutable governance. Production governance must state signer set, threshold, delay, emergency powers, and what users can do during the delay.

Facet code may be malicious or accidentally incompatible. Code review alone is not a storage-safety control. Deployment tooling must compare layouts and selector changes. The state-machine and consumer adapters can move or strand funds, so their upgrade path requires the same controls.

## 11. Failure behavior and recovery

An unknown selector reverts. A missing or invalid facet address reverts before state mutation. A failed initializer reverts the entire upgrade.

If an upgrade is bad but storage is still compatible, governance may restore the prior selector map. If it wrote incompatible storage, selector rollback may be insufficient. The proposal must include a forward repair or migration plan. No claim of rollback safety is valid without a storage-state test.

## 12. Current implementation

`contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol` declares one inheritance-based layout. `StateChannelManagerProxy.sol` stores facet addresses and forwards named methods through an internal `_delegatecall`. Its fallback sends unknown calls to the consumer. `StateChannelCommon.sol` is inherited into facets and contains storage-aware and pure behavior. `LocalDiamond.sol` inherits the proxy.

Artifact inspection during this specification review produced these runtime sizes:

| Artifact                   | Runtime bytes | Over EIP-170 by |
| -------------------------- | ------------: | --------------: |
| `LocalDiamond`             |        41,552 |          16,976 |
| `StateChannelManagerProxy` |        30,959 |           6,383 |
| `DisputeFraudProofFacet`   |        26,436 |           1,860 |
| `DisputeVerificationFacet` |        24,783 |             207 |

Hardhat sets `allowUnlimitedContractSize: true`, so local deployment does not expose this failure.

## 13. Difference from the intended design

| Classification     | Difference                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| missing            | no selector table or Diamond cut mechanism                                                       |
| missing            | no explicit upgrade authorization, activation, initialization, or rollback contract              |
| bug                | production-size deployments fail EIP-170 for several current artifacts                           |
| missing            | no fixed versioned root slots or old-namespace migration design                                  |
| documentation debt | current `onlySelf` calls depend on wrapper self-calls and need redesign under selector routing   |
| decision pending   | whether production deployments are immutable per application version or governed and upgradeable |
| missing            | no automated selector collision and storage layout gate                                          |

## 14. Dependencies and cross-layer effects

TypeScript contract factories, LocalEVM setup, event replay, deployments, and E2E fixtures depend on constructor and selector behavior. Storage migration affects event synchronizers and any SDK view that assumes a V1 getter. Application adapter upgrades affect state hashes and must coordinate with fork versioning.

## 15. Verification

Required tests include:

- selector add, replace, remove, collision, and unknown selector;
- direct facet calls cannot mutate manager state;
- initializer once-only and atomic rollback;
- upgrade from a storage image containing active channels in every dispute phase;
- old namespace read or migration until all old windows settle;
- config update cannot alter existing window deadlines;
- production compiler bytecode-size gate;
- fuzzed storage slots showing no namespace overlap;
- consumer selector isolation;
- local-only helpers absent from production routing.

The current repository has functional facet tests but no complete production Diamond upgrade or size suite.

## 16. Future work

After the routing and namespace design is fixed, evaluate packed config and participant membership storage. Gas optimization must follow layout stability and recovery executability, not lead them.
