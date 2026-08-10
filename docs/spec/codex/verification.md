# Verification and evidence plan

## Status and purpose

This chapter defines what counts as evidence that the specification and implementation agree. It records current repository coverage and missing work. It does not claim that a behavior is verified because a related test exists.

The test name, assertion, input range, environment, source revision, and result must all support the stated claim. Security and economic claims need adversarial and boundary cases, not only a successful lifecycle.

## 1. Evidence states

Every requirement is assigned one state:

| State          | Meaning                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `verified`     | Current code and focused evidence satisfy the stated scope.                |
| `partial`      | Some paths have evidence, but named cases or environments are missing.     |
| `gap`          | Requirement is specified but no adequate implementation/evidence exists.   |
| `contradicted` | Current code is known to behave differently from the intended requirement. |
| `decision`     | Behavior cannot be verified until an engineer chooses a design.            |

`verified` applies to the exact row only. It does not spread to a parent subsystem.

## 2. Verification layers

### 2.1 Static and build checks

Static checks establish that Solidity, generated ABIs, TypeScript, Node, and browser targets agree enough to build. They include:

- Solidity compilation with the release compiler and optimizer;
- TypeChain, enum, and artifact regeneration;
- Node TypeScript type checking;
- browser TypeScript type checking;
- package assembly and exported-file inspection;
- formatting and lint checks;
- runtime bytecode size checks;
- ABI/schema compatibility checks against saved golden data.

Compilation proves neither deployability nor protocol correctness. Current Hardhat configuration permits oversized contracts.

### 2.2 Solidity unit and property tests

Contract tests invoke public facets and targeted harness entry points. They cover success, rejection, state effects, events, custom errors, caller/target rules, deadline equality, duplicate evidence, and malformed proof data.

Properties should generate input permutations rather than depend on one hand-built order. This is required for reduction, survivor order after kills, slash/self-removal sets, signature sets, and linked message ranges.

### 2.3 SDK unit tests

SDK units cover codecs, model validation, storage ownership, queues, signature collection, timing calculations, event dispatch, configuration, RPC guards, abort behavior, and reduction orchestration.

Mocks must preserve contract ownership of predicates. A mocked `staticCall` that always returns the expected value does not show Solidity and SDK agree.

### 2.4 Cross-language vectors

Solidity and TypeScript must consume the same checked-in vectors for:

- every ABI-shared struct;
- block, snapshot, message, dispute, and auditing hashes;
- every signature wrapper;
- enum translation;
- balance algebra examples;
- fork ID derivation;
- reduction inputs and output;
- state proof traversal.

Each vector contains source values, canonical bytes, hash, expected signer where relevant, and expected rejection for mutations. This layer is mostly absent today.

### 2.5 Integration tests

Integration tests run the SDK against deployed contracts or the local diamond and assert both sides of the boundary. They must inspect chain state and emitted logs, not only SDK return values.

### 2.6 End-to-end tests

E2E tests run multiple authenticated peers, local execution, chain transactions, event handling, and recovery. They cover real ordering and timers. Tests should state whether they use automine, interval mining, workers, local/WebRTC transport, and in-memory storage.

An E2E test using one process and an unlimited-size local chain is not production deployment, persistence, provider, or network evidence.

### 2.7 Model and fault-injection tests

State-machine or property models are required for finality and reduction. Fault injection is required for crash recovery, reorgs, dropped messages, delayed evidence, failed consumer calls, provider disagreement, and transaction replacement.

## 3. Standard commands

Use the narrowest relevant command first, then the full safe gate for implementation changes.

| Scope                       | Command                                           |
| --------------------------- | ------------------------------------------------- |
| One Hardhat/TypeScript test | `yarn hardhat test --no-compile <test-file>`      |
| Non-E2E suite               | `yarn test`                                       |
| E2E suite                   | `yarn test:e2e`                                   |
| Parallel repository gate    | `yarn test:parallel`                              |
| Compile and regenerate      | `yarn compile`                                    |
| Node type check             | `yarn tsc --noEmit -p tsconfig.json`              |
| Browser type check          | `yarn tsc --noEmit -p tsconfig.browser.json`      |
| Markdown format             | `yarn prettier --check 'docs/spec/codex/**/*.md'` |

The release gate also needs code-size, gas, cross-language vector, persistent restart, and target-chain deployment checks that do not yet have one canonical command.

## 4. System traceability matrix

Paths are repository-relative.

| Requirement                                                          | Main implementation                                                     | Current evidence                                                           | State        | Missing evidence or implementation                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| Complete snapshot commits state, membership, streams, and accounting | `contracts/V1/types/DataTypes.sol`, `src/models/StateSnapshot.ts`       | `test/models/StateSnapshot.test.ts`, `test/e2e/E2E-StateSnapshots.test.ts` | partial      | Hash sensitivity vectors for every field and restart persistence.                          |
| Deterministic state-machine replay                                   | `contracts/V1/AStateMachine.sol`, `src/evm/EvmDiamondStateMachine.ts`   | `test/e2e/E2E-StateTransition.test.ts`, invalid-transition fraud tests     | partial      | Ambient-context rejection and cross-runtime state vectors.                                 |
| Aggregate balance conservation                                       | balance verification in snapshot/dispute facets and application algebra | `test/e2e/disputeValidation/balanceInvariant.test.ts`                      | partial      | Custom balance data, multiple assets, rounding, consumer failure, and property generation. |
| Continuous execution without per-block unanimity                     | `src/stateManager/StateManager.ts`, agreement manager                   | state transition and block confirmation E2E suites                         | partial      | Delayed/partitioned virtual-vote histories and formal threshold model.                     |
| Latest valid history carries through recovery                        | contract reducer and `src/stateManager/reduction/`                      | reduction unit/E2E suites                                                  | partial      | Equal-height decision approval and generated order-independence.                           |
| Milestones followed by nonfinal suffix                               | state proof facet and agreement manager                                 | none for intended form                                                     | contradicted | Contract currently rejects mixed arrays and SDK drops suffix.                              |
| Every dispute window yields one successor                            | dispute/reduction facets and managers                                   | ordinary and final dispute E2E suites                                      | gap          | All commitments killed has no complete successor rule.                                     |
| Chain events reproduce manager state locally                         | listener, `EventSyncService`, local diamond                             | `test/stateManager/EventSyncService.test.ts`, runtime-event E2E            | contradicted | Reorg-safe ordered cursor; missing outbound-processing dispatch.                           |
| Accepted state survives restart                                      | `src/storage/`                                                          | in-memory storage unit tests                                               | contradicted | Durable adapter, atomic transactions, crash and restore tests.                             |

## 5. Opening, membership, and settlement matrix

| Requirement                                                            | Main implementation                                     | Current evidence                                                  | State    | Missing work                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Signed open proposal fixes participants, balances, deadline, and mode  | open negotiation service and manager open path          | open negotiation/unit and `StateChannelManagerProxyOpen.test.sol` | partial  | Cross-language proposal vectors and adversarial duplicate/signature cases.       |
| Atomic open admits all or reverts                                      | manager open path                                       | Solidity open tests                                               | partial  | Consumer transfer failure/reentrancy and nonstandard asset cases.                |
| Non-atomic open uses only successful deposits                          | manager/consumer open path                              | Solidity open tests                                               | partial  | Deterministic ordering and genesis agreement across SDK/contract.                |
| Spectator verifies before depositing                                   | `src/rpc/services/spectate/`                            | spectate, stale-proof, and abort E2E suites                       | partial  | Multi-source disagreement, reorg, byte limits, and durable staging.              |
| Join deposit is pending until canonical inbound processing             | manager join and event handlers                         | join race and force-join E2E suites                               | partial  | SDK currently exposes pending before canonical event; reorg rollback absent.     |
| Failed join has bounded recovery or refund                             | force-join paths                                        | force-join E2E                                                    | decision | Refund/terminal recovery design is not chosen.                                   |
| Membership change updates author and proof threshold deterministically | state machine, validation, proof facets                 | participant lifecycle and stale-membership E2E                    | partial  | Multiple changes across milestones, insertion/removal permutations.              |
| Normal exit flows through outbound stream and consumer                 | state machine exit, snapshot update, manager processing | participant lifecycle E2E                                         | partial  | Generic consumer failures, replay, reentrancy, and partial batch recovery.       |
| Withdrawal processes each outbound height once                         | snapshot/manager processing                             | state snapshot and lifecycle tests                                | partial  | Arbitrary custom streams, reorg, persistent restart, batch-equivalence property. |

## 6. Block pipeline matrix

| Stage                | Required assertion                                           | Current evidence                          | State   | Missing work                                                   |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------- | ------- | -------------------------------------------------------------- |
| Author selection     | pre-state returns one expected active participant            | validation unit and transition E2E        | partial | Generated membership orders and terminal state.                |
| Transaction signing  | recovered signer equals header participant and session scope | signature/validation tests                | partial | One protocol-wide domain and cross-deployment replay cases.    |
| Inbound selection    | range is contiguous from current head and totals recompute   | snapshot/storage/E2E tests                | partial | Fuzzed gaps, repeats, custom messages, and reorg.              |
| Replay               | exact pre-state and input produce full post-snapshot         | transition and invalid-transition tests   | partial | Cross-runtime vectors and application hook failure matrix.     |
| Queue merge          | duplicates add attribution without losing valid work         | queue tests and Byzantine attribution E2E | partial | Permutation, cap eviction, memory, and concurrency properties. |
| Confirmation         | unique current participants sign exact bytes                 | agreement/validation tests                | partial | Signer permutation and membership-boundary vectors.            |
| Finality             | direct/virtual evidence creates the correct milestone        | agreement and state-proof tests           | partial | Formal virtual-vote safety and mixed proof.                    |
| Failure rollback     | failed candidate restores exact live state                   | validation and abort tests                | partial | Crash during replay and failure after cross-store writes.      |
| Publication fallback | missing data becomes available on chain in time              | block calldata and timeout E2E            | partial | Cost bound, provider censorship, and deadline margin.          |

## 7. Fraud-proof matrix

### 7.1 Block fraud proofs

| Proof type                    | Solidity evidence                                        | SDK/E2E evidence                                    | State   | Missing cases                                                    |
| ----------------------------- | -------------------------------------------------------- | --------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `BlockDoubleSign`             | `test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol` | `test/e2e/E2E-FraudProofsBlockConfirmation.test.ts` | partial | Cross-milestone equivocation and wrong proof target.             |
| `BlockInvalidStateTransition` | fraud facet tests                                        | fraud/block validation E2E                          | partial | Revert variants, gas exhaustion, custom state machine.           |
| `WrongGenesis`                | fraud facet tests                                        | fraud E2E                                           | partial | Deployment-domain replay and malformed genesis bytes.            |
| `InvalidTimestamp`            | fraud facet tests                                        | first-block grace, timeout, validation tests        | partial | Reorg, provider skew, equality for every height.                 |
| `ForgedInboundMessageBlock`   | fraud facet tests                                        | fraud and message E2E                               | partial | Pruned data, custom messages, repeated hash/height combinations. |

### 7.2 Dispute fraud proofs

| Claim family                           | Current evidence                                               | State    | Required additions                                                         |
| -------------------------------------- | -------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Stale latest state                     | `test/e2e/disputeValidation/notLatestState.test.ts`            | partial  | Competing equal heights and membership changes.                            |
| Invalid output state                   | `outputState.test.ts` and Solidity facet tests                 | partial  | Every removal/slash combination and custom balance.                        |
| Invalid state proof/linkage            | invalid state proof and genesis linkage E2E tests              | partial  | Mixed proof, long proof, malformed ABI, unavailable anchor.                |
| Balance invariant                      | `balanceInvariant.test.ts`                                     | partial  | Custom balance data and consumer behavior.                                 |
| Slash set                              | Solidity/dispute manager tests                                 | decision | Choose subset versus automatic inclusion, then add permutations.           |
| Timeout family                         | `E2E-Timeouts.test.ts`, validation tests, Solidity facet tests | partial  | Collusion, selective disclosure, forced race, all boundary equalities.     |
| Bad block in proof                     | validation strategy and fraud tests                            | partial  | Every block violation at every proof position.                             |
| No final/audit basis                   | invalid-state auditing tests                                   | gap      | Define safe missing-data behavior.                                         |
| Header/inbound/structure/author checks | dispute validation and Solidity tests                          | partial  | Generated malformed inputs and wrong-target checks for each enum.          |
| Invalid reason/economics               | dispute fraud facet tests                                      | decision | Approve proof-sender/disputer penalties and malformed submission behavior. |

For each proof type, add one machine-readable case table containing verifier entry point, evidence tuple, accused role, expected address, state effect, event, and maximum gas.

## 8. Reduction matrix

| Property                             | Current implementation/evidence              | State        | Required addition                                                      |
| ------------------------------------ | -------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| Highest valid transaction count wins | reducer plus reduction tests                 | partial      | Generated histories and state-proof validation for candidates.         |
| Equal-height choice is deterministic | smaller block hash in current reducer        | decision     | Engineer approval and safety argument.                                 |
| Earliest valid timeout wins          | reducer/timeout tests                        | partial      | Multiple heights, equal time, forced timeout, disclosure permutations. |
| Slash beats timeout/self-removal     | reducer logic/tests                          | partial      | Same participant in every combination.                                 |
| Set operations ignore evidence order | reducer assumes set-like behavior            | gap          | Permute disputes, survivors after swap removal, slash/removal arrays.  |
| Duplicate evidence is harmless       | commitment/posted checks                     | partial      | Duplicate bytes from multiple senders and restart replay.              |
| Expired window cannot reopen         | current evidence handling                    | contradicted | Empty-commitment late-evidence regression test and fix.                |
| All killed still yields successor    | no complete rule                             | gap          | Normative algorithm, Solidity/SDK implementation, E2E.                 |
| Replacement gets safe challenge time | current timestamp backdating                 | contradicted | Fresh-window rule and deadline-boundary E2E.                           |
| Reducer eligibility matches design   | current check disabled                       | decision     | Choose open or restricted reducer and test every entry point.          |
| SDK and Solidity output match        | SDK calls contract `staticCall` in core path | partial      | Independent golden vectors and divergence alarm.                       |

## 9. Time and chain matrix

| Requirement                                   | Current evidence                                                      | State        | Missing work                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- | ------------ | -------------------------------------------------------------- |
| Four deployed time values match local runtime | setup/deployment paths and harness time config                        | partial      | Startup mismatch rejection and manifest check.                 |
| First block receives `evidenceTime` grace     | `test/e2e/E2E-FirstBlockTimestampGrace.test.ts`, `test/Clock.test.ts` | partial      | Every contract/SDK boundary equality.                          |
| Later blocks do not receive first-block grace | validation and timeout tests                                          | partial      | Generated height and fork transition cases.                    |
| Clock estimate follows recent chain blocks    | `test/Clock.test.ts`                                                  | partial      | Maximum skew, safety lag, periodic resync, reorg.              |
| Event processing follows canonical log order  | event sync tests                                                      | contradicted | Transaction/log cursor and sequential apply.                   |
| Reorg rolls back local mirror and decisions   | none                                                                  | gap          | Reorg at join, block calldata, dispute, reduction, withdrawal. |
| Provider disagreement fails safely            | none                                                                  | gap          | Stale, lying, omitting, partitioned, and failover providers.   |
| Deadline actions retain confirmation margin   | timers and E2E waits                                                  | partial      | Production fee/nonce/inclusion model and stress test.          |

## 10. Network and resource matrix

| Requirement                                               | Current evidence                         | State    | Missing work                                                      |
| --------------------------------------------------------- | ---------------------------------------- | -------- | ----------------------------------------------------------------- |
| Guarded RPC requires authenticated handshake              | handshake guard and RPC tests            | partial  | Replay across sessions and reconnect races.                       |
| Handshake does not sign bare attacker-selected block hash | challenge-domain tests                   | partial  | Protocol/deployment version binding.                              |
| Oversized outer frame is rejected                         | RPC transport tests                      | partial  | Method-specific limits below 16 MiB.                              |
| Signature recovery cache is bounded                       | `test/cache/SignerRecoveryCache.test.ts` | verified | Verified only for cache bound/eviction behavior.                  |
| Per-entry queue attribution is bounded                    | queue tests                              | partial  | Global bytes, many hashes, adversarial valid signatures.          |
| Peer request rate and concurrency are bounded             | no full policy                           | gap      | Token buckets, global budgets, fairness, recovery priority.       |
| Slow work can be cancelled                                | worker shutdown/abort tests              | partial  | All local EVM and spectator paths under flood.                    |
| Blacklist does not become slash evidence                  | architectural separation                 | partial  | Audit every attribution path and request-failure classification.  |
| Spectator sync is bounded and staged                      | spectate tests                           | gap      | Durable staging, limits, multiple sources, interrupted promotion. |

## 11. Persistence and recovery matrix

| Failure point                             | Required post-restart result                                    | Current state                                |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Before candidate validation               | Candidate may be retried; canonical state unchanged.            | Gap: memory-only.                            |
| After state replay, before acceptance     | Staged state is discarded or replayed; never advertised.        | Gap: memory-only.                            |
| During block/snapshot/message commit      | Either all canonical records exist or none do.                  | Gap: no cross-store transaction.             |
| After chain effect, before cursor commit  | Event is reapplied idempotently.                                | Gap: volatile cursor.                        |
| After cursor commit, before derived state | Forbidden by atomic event transaction.                          | Contradicted by current design.              |
| During dispute evidence collection        | Signed objects and deadline action survive.                     | Gap: memory-only.                            |
| During chain transaction submission       | Receipt reconciliation prevents duplicate economic action.      | Gap: no durable operation journal.           |
| During spectator promotion                | Old canonical state remains valid until full new state commits. | Gap: no durable staging.                     |
| During shutdown                           | Workers stop and database/event state is consistent.            | Partial: worker shutdown tests, no database. |

Crash tests must terminate the process, not throw within one call and let JavaScript cleanup run.

## 12. Deployment and operations matrix

| Requirement                                         | Current evidence                           | State        | Missing work                                              |
| --------------------------------------------------- | ------------------------------------------ | ------------ | --------------------------------------------------------- |
| Contracts compile with pinned settings              | compile pipeline                           | verified     | Verified only for repository compile settings.            |
| Every deployed runtime is under target limit        | measured artifacts                         | contradicted | Proxy, local diamond, and two facets exceed 24,576 bytes. |
| Production time values are nonzero and reviewed     | deploy helper defaults to zero             | contradicted | Strict deployment validation.                             |
| Local bytecode equals deployed manifest             | none                                       | gap          | Manifest and startup hash checks.                         |
| Max proof/reduction fits gas/calldata policy        | selected tests only                        | gap          | Defined bounds and production-chain measurements.         |
| Backup restores an active disputed channel          | none                                       | gap          | Durable adapter and restore E2E.                          |
| Logs and crash uploads redact secrets               | logger/upload tests cover mechanics        | partial      | Data classification and redaction assertions.             |
| Browser and worker modes preserve protocol behavior | browser/worker and runtime transport tests | partial      | Same vector suite across every mode.                      |

## 13. Required scenario catalogue

### 13.1 Normal lifecycle

1. negotiate and open a non-atomic multiparty channel;
2. reject one deposit and derive matching genesis everywhere;
3. spectate from two peers and verify before joining;
4. process join, top-up, custom inbound data, and membership threshold change;
5. execute continuously through direct and virtual finality;
6. carry a nonfinal suffix after a milestone;
7. create ordinary exits and process outbound messages in batches;
8. settle all assets and prove no unresolved residue was deleted.

### 13.2 Availability failures

- scheduled author offline before and after first-block grace;
- confirmer unavailable while execution continues;
- block withheld then posted as calldata;
- provider outage and failover;
- process crash at each persistent commit point;
- spectator source disappears mid-sync;
- transaction is accepted into mempool but receipt is delayed;
- honest participant offline while its delegate protects deadlines.

### 13.3 Byzantine behavior

- double signing at direct and virtual confirmation positions;
- wrong author, state, genesis, timestamp, inbound range, and snapshot field;
- signatures from old, pending, duplicate, or unrelated participants;
- stale dispute, invalid output, bad balance, bad slash set, and every timeout fault;
- malformed proof whose decoder, SDK precheck, and contract disagree;
- commitment whose bytes or audit anchor are unavailable;
- reducer/challenger publishes invalid output;
- peers collude to withhold predecessor data and accuse an honest timeout target;
- relay floods valid signatures for many unique hashes;
- consumer reenters or fails on one message in a batch.

### 13.4 Concurrency and ordering

- block confirmation and block-calldata event arrive together;
- dispute event arrives while block validation holds the channel lock;
- duplicate events arrive before and after restart;
- later log is received before an earlier log in one block;
- fork reduces while old-fork blocks remain queued;
- snapshot event races a spectator sync;
- reduction timer fires while new evidence is being included;
- shutdown interrupts local EVM execution and chain event application.

## 14. Documentation traceability

Each subsystem chapter must include current source, test evidence, known difference, and future-work sections as defined by [Subsystem chapter pattern](./conventions/subsystem-chapter.md). The [review coverage map](./traceability/review-coverage.md) records where each review note is resolved.

Documentation checks must verify:

- every local link resolves;
- every source/test path named in a source map exists;
- accepted design requirements are not left in the open-decision list;
- known code contradictions are stated consistently in every owning chapter;
- terminology follows the glossary in [System model](./system-model.md);
- no chapter claims production readiness while a release blocker remains.

## 15. Recording test evidence

For implementation work, record:

- source commit and working-tree scope;
- exact command;
- environment and transport/worker mode;
- pass, fail, skipped, and retry count;
- duration;
- relevant random seed;
- artifact or log path;
- exact requirement rows supported;
- any limits the test did not exercise.

Do not reuse stale evidence after code affecting the assertion, its fixture, compiler, generated ABI, timing, or runtime mode changes.

## 16. Current conclusion

The repository has meaningful Solidity, unit, integration, browser, worker, fuzz, and multiparty E2E coverage. It gives strong implementation clues and catches many local regressions.

It does not yet establish the intended V1 protocol guarantee. The main reasons are known implementation contradictions, no durable/reorg-safe node state, incomplete resource bounds, unavailable mixed proofs, open reduction outcomes, no complete watchtower path, and deployment bytecode above target limits.

## 17. Future work

Non-normative verification work includes model checking, mutation testing of proof handlers, long-running network simulation, target-chain shadow deployments, and generated requirement-to-test indexes. These extend evidence after the named V1 gaps are closed.
