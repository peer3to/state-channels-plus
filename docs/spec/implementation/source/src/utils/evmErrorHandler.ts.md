# evmErrorHandler.ts

> **Source:** [src/utils/evmErrorHandler.ts](../../../../../../src/utils/evmErrorHandler.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)

## UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF

Classification

- Setup: Decode each named error; unknown errors; non-revert failures
- Oracle: Named handlers fire exactly; unknowns report unhandled; decode robust

- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P1` — RaceConditionChannelAlreadyOpen
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P2` — unknown error
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P3` — malformed revert data
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P4` — RaceConditionBlockCalldataTimestampTooLate
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P5` — RaceConditionSnapshotForkMismatch
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P6` — RaceConditionBlockHeightTooOld
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P7` — RaceConditionJoinChannelExpired
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P8` — RaceConditionJoinChannelSnapshotMismatch
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P9` — RaceConditionPendingInboundNotConsumed
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P10` — RaceConditionJoinChannelForkDisputed
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P11` — RaceConditionDisputeEvidencePeriodExpired
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P12` — RaceConditionDisputeKillPeriodNotExpired
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P13` — RaceConditionDisputeKillPeriodExpired
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P14` — RaceConditionDisputeAlreadyReduced
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P15` — RaceConditionReductionExpectationDoesntMatch
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P17` — RaceConditionDisputeTimeoutCalldataPosted
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P18` — RaceConditionDisputeTimeoutPreviousBlockProducerPostedCalldataMismatch
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P19` — RaceConditionDisputeTimeoutNotMinTimestamp
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P20` — RaceConditionDisputeTimeoutWindowCreatedTooEarly
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P21` — RaceConditionUnexpectedBlockCalldataPosted
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P22` — RaceConditionGenesisTimestampNotAvailable
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P23` — RaceConditionOnChainSlashes
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P24` — ErrorCantParticipateInDispute
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P25` — ErrorDisputePostedAuditingDataMismatch
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P26` — ErrorDisputeChallengePeriodExpired
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P27` — ErrorDisputeCommitmentNotAvailable
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P28` — generated error union includes all reachable ECDSA errors
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P29` — ECDSAInvalidSignatureS decodes with its argument
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P30` — generated artifact inputs include every routed facet
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P31` — a local revert as the local signer wraps it is an EVM execution failure
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P32` — an error without the revert marker is not an EVM execution failure

## UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W

Invalid state transition rule

- Setup: Run a Math machine on a real `ContractExecutor` (inline, or SDK-owned with a corrupted request) and classify the error of a reverting, an under-funded, an input-exhausted and an executor-failed transition
- Oracle: Exactly the in-EVM revert is invalid; the refusal, the frame out-of-gas and the executor failure are not

- [x] `UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P1` — a transition that reverts inside the local EVM is an invalid state transition
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P2` — the machine's refusal to run under-funded (`ErrorInsufficientGasForStateTransition`) is not an invalid state transition
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P3` — an out-of-gas of the call's own frame (input copy before the stipend check) is not an invalid state transition
- [x] `UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P4` — a failed executor connection (no revert marker) is not an invalid state transition
