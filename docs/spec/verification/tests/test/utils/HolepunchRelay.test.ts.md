# test/utils/HolepunchRelay.test.ts — Test Report

> **Test file:** [test/utils/HolepunchRelay.test.ts](../../../../../../test/utils/HolepunchRelay.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [HolepunchRelay.ts](../../../../implementation/source/src/HolepunchRelay.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite isolates the relayer-pool failover/backoff logic in `HolepunchRelay`: the hyperswarm
modules (`hyperswarm`, `@hyperswarm/dht-relay`, `@hyperswarm/dht-relay/ws`) are stubbed through
the require cache before load, `global.WebSocket` is replaced with a manually driven fake, and
sinon fake timers control every retry timer; the singleton is reset between cases. Each test
calls `HolepunchRelay.init` with a relayer URL list and drives failures via
`emitClose`/`emitError`/`emitOpen`, asserting on the update-callback count, the URLs of created
sockets, and the `setTimeout` delays captured by a spy. The oracles pin regression behavior: the
pool never permanently exhausts after more failures than configured relayers, a single relayer
keeps being retried, a successful connection resets exclusion/backoff state, single-failure
retries carry a randomized sub-250ms jitter, and full-round exhaustion uses full-jitter backoff
rather than a deterministic 1s mark. Real DHT wiring, message relay, and the transport built on
top are out of scope. The seed pool defines no permutations for this component, so no test IDs
are assignable here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                     | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`HolepunchRelay > does not permanently exhaust the relayer pool after more failures than configured relayers`](../../../../../../test/utils/HolepunchRelay.test.ts#L115) (line 115) | —      |
| [`HolepunchRelay > keeps retrying a single configured relayer without locking out`](../../../../../../test/utils/HolepunchRelay.test.ts#L146) (line 146)                             | —      |
| [`HolepunchRelay > resets exclusion/backoff state on a successful connection`](../../../../../../test/utils/HolepunchRelay.test.ts#L173) (line 173)                                  | —      |
| [`HolepunchRelay > adds a randomized, non-synchronized delay before retrying a single relayer failure`](../../../../../../test/utils/HolepunchRelay.test.ts#L212) (line 212)         | —      |
| [`HolepunchRelay > applies full jitter (not a deterministic mark) to the exhaustion backoff`](../../../../../../test/utils/HolepunchRelay.test.ts#L250) (line 250)                   | —      |
