# test/e2e/disputeValidation/inboundHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/inboundHash.test.ts](../../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts) > **Status:** Authored — engineer verification pending.

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
genesis happy path (`0x0` hash with height 0) is out of scope here; it lives in
`disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts`. The nearby spec
permutations bundle valid and invalid cases across audit layers, so neither test fully covers one
and the Covers column stays empty.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                              | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / inboundHash > dispute.input.latestInboundMessageBlockHash = random (not on-chain) → DisputeInboundHashNotInChain`](../../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L11) (line 11)                          | —      |
| [`E2E: dispute validation / inboundHash > dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight > 0 → DisputeInboundHashNotInChain`](../../../../../../../../test/e2e/disputeValidation/inboundHash.test.ts#L39) (line 39) | —      |
