# test/e2e/disputeValidation/inboundHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/inboundHash.test.ts](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two tests probe the on-chain walk that validates `dispute.input.latestInboundMessageBlockHash`
against the inbound message-block chain. Each stubs peer 0's `constructDispute` to plant a junk
value — a random hash that exists nowhere on-chain, or `ZeroHash` combined with
`lastInboundMessageBlockHeight = 999999n` — and then provokes the dispute by having peer 1 submit
a double-sign block. The oracles assert the tampered dispute is initiated and committed without
auditing data, at least one honest peer fires `onDisputeKilled`, honest peers store a
`DisputeInboundHashNotInChain` dispute fraud proof, and the fork resolves to a successor. The
honest replacement is constructed only after its auditor observes the kill, so its output includes
the killed disputer's slash before submission can become threshold-final. The
genesis happy path (`0x0` hash with height 0) is out of scope here; it lives in
`disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts`. After the permutation
atomization, the inbound-tip check failure, its proof family, and its mirrored-predicate
agreement exist as single-scenario IDs; they are split across the two tests below.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                           | Covers                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / inboundHash > dispute.input.latestInboundMessageBlockHash = random (not on-chain) → DisputeInboundHashNotInChain`](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L17) (line 17)                          | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P1`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p1), [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P18`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p18) |
| [`E2E: dispute validation / inboundHash > dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight > 0 → DisputeInboundHashNotInChain`](../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L51) (line 51) | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P6`](../../../../../implementation/source/src/stateManager/utils/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p6)                                                                                                                                     |
