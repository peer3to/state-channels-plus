# test/scripts/e2eParallelDistributedE2E.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelDistributedE2E.test.ts](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite is the system-level exercise of the distributed parallel e2e runner in `scripts/e2e-parallel/distributed/`: it wires real components together — the local discovery registry child process (`test/utils/nodeInfra.js`), Hyperswarm-style pools over an in-process DHT (`test/fixtures/distributed/testTransport`), `ProtocolPeer` framing over real socket pairs, pool authentication, `WorkerLeaseManager`, `WorkerAttemptSpool`, `OrchestratorLogStore`, bundle transfer, `runDistributed`, and `runTask` process-group management. Oracles assert lifecycle logs of the discovery child, dial-failure fallback to a reverse connection, worker-initiated transport with correct client/server auth roles, ongoing discovery of late-joining servers, prompt cancellation of `runDistributed` via an `AbortController`, kill of infrastructure grandchildren after a test process exits, preservation of termination signals, rejection of wrong-secret clients before any lease request, rejection of bundle paths outside the offered manifest, containment of a preparation failure after orchestrator disconnect, and a full authenticated attempt-log transfer with lease release and spool cleanup. Everything under test is the test-orchestration tooling in `scripts/`, not the production SDK or contracts, so no specification or implementation test-plan permutation from the pool applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                    | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed parallel runner > records the discovery server lifecycle before closing its log`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L48) (line 48)                  | —      |
| [`distributed parallel runner > yields a failed outgoing dial so the peer can reverse the connection`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L96) (line 96)           | —      |
| [`distributed parallel runner > authenticates when the worker establishes the transport connection`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L195) (line 195)           | —      |
| [`distributed parallel runner > keeps discovering and connects to worker servers that appear later`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L255) (line 255)           | —      |
| [`distributed parallel runner > cancels while discovering before any worker connects`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L317) (line 317)                         | —      |
| [`distributed parallel runner > kills infrastructure grandchildren after a test process exits`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L348) (line 348)                | —      |
| [`distributed parallel runner > retains the test process termination signal`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L391) (line 391)                                  | —      |
| [`distributed parallel runner > rejects a wrong-secret client before it can request a lease`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L408) (line 408)                  | —      |
| [`distributed parallel runner > rejects source paths not present in the offered manifest`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L440) (line 440)                     | —      |
| [`distributed parallel runner > contains a preparation failure after the orchestrator disconnects`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L505) (line 505)            | —      |
| [`distributed parallel runner > moves an authenticated attempt log over a real socket and releases the lease`](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts#L549) (line 549) | —      |
