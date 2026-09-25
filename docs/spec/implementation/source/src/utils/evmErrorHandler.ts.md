# evmErrorHandler.ts

> **Source:** [src/utils/evmErrorHandler.ts](../../../../../../src/utils/evmErrorHandler.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)

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
- [ ] `UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P10` — RaceConditionForceInboundJoinForkDisputed
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
