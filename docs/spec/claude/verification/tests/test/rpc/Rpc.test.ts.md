# test/rpc/Rpc.test.ts — Test Report

> **Test file:** [test/rpc/Rpc.test.ts](../../../../../../../test/rpc/Rpc.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Rpc.ts](../../../../implementation/source/src/rpc/Rpc.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite unit-tests the wire codec in `src/rpc/Rpc.ts` directly, with no dispatcher, transport,
or harness: each test feeds a JSON string (or a `serializeRpc` product) to `deserializeRpc` and
asserts on the return value alone. It round-trips a well-formed request envelope with array
params, checks `requestId` survives for request-style RPCs, and asserts `undefined` for every
malformed variant — non-array `params` (string, object, number, boolean, null), missing `params`,
non-string `service`/`method`, and invalid JSON — the regression guard for the dispatcher's
`method(...rpc.params)` spread. A last test asserts `MAX_RPC_FRAME_BYTES` is positive; the actual
frame-size gate, `RpcResponse` encode/decode, and BigInt serialization are out of scope. The
planned `UNIT-TEST-RPC-WIRE-1` permutations each bundle scenarios this suite either splits across
separate tests (P2's "each malformed shape") or does not reach (P1's response round trip, P3's
raw-BigInt throw, P4's boundary-size frame), so no permutation is fully covered by a single test
here and none is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                              | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`deserializeRpc - params schema > accepts a well-formed RPC with array params`](../../../../../../../test/rpc/Rpc.test.ts#L12) (line 12)     | —      |
| [`deserializeRpc - params schema > preserves requestId for request-style RPCs`](../../../../../../../test/rpc/Rpc.test.ts#L20) (line 20)      | —      |
| [`deserializeRpc - params schema > <dynamic: `rejects params that are a ${label}`>`](../../../../../../../test/rpc/Rpc.test.ts#L39) (line 39) | —      |
| [`deserializeRpc - params schema > rejects when params is missing entirely`](../../../../../../../test/rpc/Rpc.test.ts#L47) (line 47)         | —      |
| [`deserializeRpc - params schema > rejects a non-string service or method`](../../../../../../../test/rpc/Rpc.test.ts#L53) (line 53)          | —      |
| [`deserializeRpc - params schema > returns undefined on invalid JSON`](../../../../../../../test/rpc/Rpc.test.ts#L62) (line 62)               | —      |
| [`deserializeRpc - params schema > exposes a positive frame-size bound`](../../../../../../../test/rpc/Rpc.test.ts#L66) (line 66)             | —      |
