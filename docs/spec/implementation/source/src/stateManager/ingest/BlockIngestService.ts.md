# BlockIngestService.ts — Source Report

> **Source:** [src/stateManager/ingest/BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The serialized execution boundary of the block-confirmation pipeline: takes one queued entry
under the state-manager mutex, validates it through the caller's strategy (the active one by
default), executes the transition, and hands the outcome to the commit and merge owners. It is the
single entry both the network queue and the synchronization replay use; a replayed confirmation
enters here as a fresh entry carrying its origin.

## Key design decisions

A struct replay may carry BlockPredecessor. It bypasses the stored-block merge shortcut, repositions execution to the supplied state, and validates/executes with its snapshot. Merely storing supporting evidence does not establish that its transition has replayed. Dispute strategy relies on prior canonical proof checks; this adapter alone does not classify every malformed dispute proof. See [BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L161).

Struct replay creates an explicit internal proof entry, preserving historical evidence and the supplied strategy without inventing a network source. New-block validation classifies confirmations through ValidationService and routes recovery failures through the strategy. Resulting membership is computed from the supplied snapshot before persistence. Dequeued entries follow the existing processing and restore flow with their source attribution. See [onBlockConfirmationStruct](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L36).

The existing strategy option carries proof replay. No separate replay flag is propagated through the ingest entry. See [BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L2).

Error text delegates to the dependency-free errorMessage helper. Existing catch policy, stack fields, log messages and error propagation remain at this call site. See [BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L1).

1. **One execution boundary for every origin.** Network deliveries, calldata recovery, dispute
   replay, and synchronization replay all execute here, so the same predicate chain and commit
   rules apply ([`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)).
2. **The caller selects the strategy, otherwise the entry decides it under the mutex.** With no explicit option the context is resolved from the work item after the state mutex is held ([#L94](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L94)), so a membership change committed meanwhile cannot leave the entry judged by a stale context, and a chain-committed entry keeps the chain-committed context. Dispute replay and verified synchronization replay select their respective strategies through the existing option. The latter accepts historical subjective timing
   ([synchronization.md](../../../../../specification/peer-communication/synchronization.md) step 13).
3. **A struct that does not decode is refused through the strategy.** `onBlockConfirmationStruct`
   ([#L36-L66](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L36-L66)), the entry for dispute replay and synchronization replay, decodes the
   confirmation with `Block.tryFromBlockConfirmation` (`Codec`, the same decoder network intake
   uses) and, when that returns `null`, hands the confirmation to the strategy's
   `authenticateBlockFailed` like an inauthentic block ([#L44-L57](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L44-L57)); it never throws on
   undecodable bytes. Its refusal log uses `LoggerUtils.getBlockConfirmationStructMetadata`
   ([#L54](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L54)), which leaves the block fields out (`undecodableBlock: true`) instead of throwing
   on those bytes ([LoggerUtils](../../utils/LoggerUtils.ts.md)). A decoded block enters as a sourceless proof entry.
4. **Authenticity reads the decoded entry block.** Pre-execution authenticity is `block.isAuthentic`
   on the entry's already-decoded block ([#L130](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L130)); a failure goes to the strategy's
   `authenticateBlockFailed`. The block is not decoded again from `blockConfirmationStruct`, and the
   signer recovered at intake is reused from the recovery memo. `isAuthentic` applies the contracts'
   signature acceptance rule ([Block](../../models/Block.ts.md) decision 3), under the signature
   carve-out of [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) ([`FIND-AUTH-1-C1ZHBJ`](../../../../../audit/open-findings.md#find-auth-1-c1zhbj) resolved).
   Decoding itself is `Codec` and is not at parity with the contracts' decoder
   ([`FIND-DECODE-1-FD1V6V`](../../../../../audit/open-findings.md#find-decode-1-fd1v6v)).
5. **A local failure of the transition leaves the ingest as an error, with the state restored.**
   The transition runs through `SnapshotAssemblyService` and
   [EvmDiamondStateMachine](../../evm/EvmDiamondStateMachine.ts.md), which returns an invalid
   transition only for a failure inside the EVM within its full budget. A refusal to run
   under-funded, an out-of-gas of the call's own frame, or an executor failure is thrown; this
   service logs and rethrows it ([#L368-L376](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L368-L376)), and its `finally`
   ([#L377-L387](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L377-L387)) restores the machine state captured before the transition. No
   strategy hook fires, so no fraud proof is built, no dispute starts, and the sender is not cut
   ([`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Inputs       | A block confirmation (struct or queued entry), optional strategy and origin. |
| Outputs      | Whether the sender's connection is kept.                                     |
| Owned state  | None.                                                                        |
| Side effects | Mutex-held execution; commit and merge delegation.                           |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                 | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlockIngestService.ts](../../../../../../../src/stateManager/ingest/BlockIngestService.ts) | [`REQ-BLOCK-PIPE-4-CF52J6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6), [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7), [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df), [`REQ-ENFSM-1-DKJCY2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) |

## Assumptions, dependencies, trust boundaries, and limits

- Runs under the state-manager mutex; validation predicates and consequences belong to
  [ValidationService](ValidationService.ts.md) and the strategies.
- The origin marker is trusted input from the synchronization service, which verified the proof
  before replaying.

## Specification adherence

- Recovered and replayed work re-enters the same validation and commitment pipeline.
- A replayed confirmation is judged as history for the subjective agreement window and objectively
  otherwise.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`REQ-BLOCK-PIPE-4-CF52J6`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6) | Covered               | **Here:** every origin executes through the one boundary. **Other files:** [BlockQueueManager](BlockQueueManager.ts.md) owns the queue and the expiry probe; [SpectateService](../../rpc/network/services/spectate/SpectateService.ts.md) replays the proven suffix through it.                                                                                                                                                                                                                                                                                | None.                                                                                                |
| [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) | Covered               | **Here:** the caller's strategy and the entry's origin reach validation unchanged. **Other files:** [ValidationService](ValidationService.ts.md) applies the subjective window to live arrivals only.                                                                                                                                                                                                                                                                                                                                                          | None.                                                                                                |
| [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)            | Covered               | **Here:** [onBlockConfirmationStruct](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L36) implements the contribution described above. **Other files:** [ValidationService.ts](ValidationService.ts.md), [BlockQueueManager.ts](BlockQueueManager.ts.md), [Storage.ts](../../storage/Storage.ts.md)                                                                                                                                                                                                                                        | Limited to this file's contribution; cache freshness and aggregate queue limits remain as specified. |
| [`REQ-ENFSM-1-DKJCY2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)           | Covered               | **Here:** a thrown local failure of the transition is rethrown ([#L368-L376](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L368-L376)) and the `finally` restores the state captured before the transition ([#L377-L387](../../../../../../../src/stateManager/ingest/BlockIngestService.ts#L377-L387)); no strategy hook fires. **Other files:** [EvmDiamondStateMachine](../../evm/EvmDiamondStateMachine.ts.md) throws instead of returning an invalid transition; [evmErrorHandler](../../utils/evmErrorHandler.ts.md) owns the rule. | None.                                                                                                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation             | Public entry and setup                                                                   | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-ingest-1-jv64as"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS` | Origin-aware execution | Hand confirmations to the boundary from the network path and as a synchronization replay | The replayed entry carries its origin and the subjective window is skipped for it; the live entry parks | <a id="unit-test-block-ingest-1-jv64as.p1"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P1` — a confirmation replayed from a verified proof outside the agreement window applies while the same live arrival parks; <a id="unit-test-block-ingest-1-jv64as.p2"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P2` — a confirmation carrying an on-chain timestamp is recorded on the stored block, observed once the store holds the timestamp; <a id="unit-test-block-ingest-1-jv64as.p3"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P3` — fresh signer validation reads the resulting participant union before persisting the snapshot; <a id="unit-test-block-ingest-1-jv64as.p4"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P4` — the same confirmation ingested twice → accepted, signatures unchanged; <a id="unit-test-block-ingest-1-jv64as.p5"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P5` — the validation context is resolved from the work item after the state mutex is held, so a chain-committed entry is judged in the chain-committed context; <a id="unit-test-block-ingest-1-jv64as.p6"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P6` — `onBlockConfirmationStruct` with bytes `Codec` cannot decode returns the strategy's `authenticateBlockFailed` verdict without throwing, executes nothing, and cuts no peer; ; <a id="unit-test-block-ingest-1-jv64as.p8"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P8` — under the dispute strategy, a replayed block whose bytes do not decode and whose state-proof structure is valid returns `true` with no proof, without throwing; <a id="unit-test-block-ingest-1-jv64as.p9"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P9` — a block one peer's local EVM refuses to run (call gas below the transition's requirement) throws out of that peer's ingest with no invalid-transition hook, no fraud proof, no dispute, no cut sender, and the turn and height unchanged, while a peer whose local EVM funds the transition commits it<br><a id="unit-test-block-ingest-1-jv64as.p10"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P10` — A tail with forged resulting snapshot fails replay; the audit stores the wrapped transition counter at its last-milestone index, stores neither failed block nor snapshot, and a second audit rejects again with one counter.<br><a id="unit-test-block-ingest-1-jv64as.p11"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P11` — A failing tail block also appearing as earlier milestone support still fails actual tail replay at its last-milestone position; the wrapped counter is stored and the failed block is absent.<br><a id="unit-test-block-ingest-1-jv64as.p12"></a>`UNIT-TEST-BLOCK-INGEST-1-JV64AS.P12` — An injected internal failure on the second dispute-replay tail block throws without a counter; the failed block is absent while the earlier successful block and its full state remain stored. |

## Related source reports

- [ValidationService](ValidationService.ts.md), [BlockQueueManager](BlockQueueManager.ts.md), [QueueStorage](../../storage/QueueStorage.ts.md), [SpectateService](../../rpc/network/services/spectate/SpectateService.ts.md)

Shared operation owners: [errorMessage.ts.md](../../utils/errorMessage.ts.md).
