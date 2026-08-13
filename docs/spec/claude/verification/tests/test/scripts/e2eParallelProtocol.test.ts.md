# test/scripts/e2eParallelProtocol.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelProtocol.test.ts](../../../../../../../test/scripts/e2eParallelProtocol.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests the wire protocol and connection plumbing of the distributed runner: `ProtocolPeer` framing and `waitForMessage`, pool-transport helpers (`flushAnnouncements`, `discoveryConfigurations`, `guardConnectionErrors`, `closeOwner`), connection lifecycle (`closeStream`, `connectionHash`, `localCloseReason`, `selectLowerHash`), the shared-secret authentication handshake (`derivePoolKeys`, `authenticateClient`/`authenticateServer`), persistent orchestrator identity, and status formatting. Several tests run over real socket pairs from `test/fixtures/distributed/testTransport`; the rest call helpers directly. Oracles assert deterministic deduplication via the lower Noise handshake hash, close attribution for local/Hyperswarm/transport causes, tolerance of pre-ownership ECONNRESET, readiness gating on announcements only, distinct worker/orchestrator discovery topics, a per-state-directory identity that regenerates on a corrupt seed, silencing of routine abandoned handshakes, byte-exact framed transfer over a fragmented socket, mutual authentication without the secret on the wire, closure of servers that cannot prove pool membership, buffered early frames, framed delivery of status/infra/preparation messages, and rejection of oversized frames and unknown message kinds. This is test-orchestration tooling under `scripts/`, not the production SDK transport, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed protocol > selects the lower authenticated Noise handshake hash`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L45) (line 45)                    | —      |
| [`distributed protocol > attributes local, Hyperswarm, and transport closes`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L55) (line 55)                      | —      |
| [`distributed protocol > tolerates a transport reset before protocol ownership is installed`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L88) (line 88)      | —      |
| [`distributed protocol > gates readiness on announcements without waiting for lookups`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L102) (line 102)          | —      |
| [`distributed protocol > keeps worker and orchestrator discovery roles on separate topics`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L127) (line 127)      | —      |
| [`distributed protocol > persists one orchestrator identity per state directory`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L149) (line 149)                | —      |
| [`distributed protocol > silences abandoned discovery authentication handshakes`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L176) (line 176)                | —      |
| [`distributed protocol > preserves framed binary messages over a real fragmented socket`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L195) (line 195)        | —      |
| [`distributed protocol > authenticates both peers without putting the secret on the wire`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L211) (line 211)       | —      |
| [`distributed protocol > closes a server that cannot prove pool membership`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L244) (line 244)                     | —      |
| [`distributed protocol > retains a follow-up frame that arrives before its waiter is installed`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L281) (line 281) | —      |
| [`distributed protocol > transfers concise worker status updates`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L300) (line 300)                               | —      |
| [`distributed protocol > transfers infrastructure diagnostics with their process failure`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L317) (line 317)       | —      |
| [`distributed protocol > transfers workspace preparation failures explicitly`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L357) (line 357)                   | —      |
| [`distributed protocol > formats queued progress and its estimated wait`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L383) (line 383)                        | —      |
| [`distributed protocol > rejects oversized and truncated frames`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L398) (line 398)                                | —      |
| [`distributed protocol > rejects unknown message kinds before they reach a lease owner`](../../../../../../../test/scripts/e2eParallelProtocol.test.ts#L413) (line 413)         | —      |
