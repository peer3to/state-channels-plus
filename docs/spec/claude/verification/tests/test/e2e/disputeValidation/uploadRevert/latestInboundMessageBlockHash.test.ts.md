# test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single positive case for the inbound-anchor check at upload: `postTamperedDispute` sets
`dispute.input.latestInboundMessageBlockHash = ZeroHash` with
`lastInboundMessageBlockHeight = 0`, the genesis anchor of the inbound message chain.
`_isDisputeInboundHashValid` walks the on-chain inbound chain backwards and accepts any valid
ancestor with a matching height, so the upload succeeds even though the inbound chain has
advanced past genesis; the oracle is at least one committed dispute observed for peer 1. Junk
inbound-hash variants (a non-genesis random hash, or genesis hash with height > 0) live
deliberately in `disputeInputFields/inboundHash.test.ts` because they fail through the
fraud-proof pipeline rather than upload revert. No permutation in the pool isolates this
positive-ancestor scenario — the candidates bundle valid and invalid inbound-tip cases — so
no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                                      | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / uploadRevert / latestInboundMessageBlockHash > dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight = 0 → dispute upload succeeds (genesis anchor is always a valid ancestor)`](../../../../../../../../../test/e2e/disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts#L5) (line 5) | —      |
