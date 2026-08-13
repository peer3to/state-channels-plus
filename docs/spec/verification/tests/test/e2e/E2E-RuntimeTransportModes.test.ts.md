# test/e2e/E2E-RuntimeTransportModes.test.ts — Test Report

> **Test file:** [test/e2e/E2E-RuntimeTransportModes.test.ts](../../../../../../test/e2e/E2E-RuntimeTransportModes.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite proves the `EvmStateMachine.p2pSetup` runtime behaves identically across its four
threading modes: the dynamic test runs once per `RUN_SDK_IN_THREAD` × `VM_DEDICATED_THREAD`
combination, deploying a fresh full stack and driving the same operation battery through the
port-backed `chainSigner` and contract proxies with identical assertions in every mode. The
battery covers reads (addresses, `getAllTimes`, state, participants), the whole signing surface
(`signMessage` on strings and bytes, `signTypedData`, `signTransaction`, `populateCall`/
`populateTransaction`), concurrent `sendTransaction` calls that must get consecutive nonces and
successful receipts, and failure equivalence: `resolveName` rejects with `UNSUPPORTED_OPERATION`
and a mismatched `from` rejects with `INVALID_ARGUMENT` before any signing happens. A second test
proves `p2pSetup` generates a host-owned signer when no `signerSecret` is supplied and the runtime
still serves contract reads. Oracles are ethers-level recoveries (`verifyMessage`,
`verifyTypedData`, `Transaction.from`) and error codes, so equivalence is judged on observable
results, not internals; p2p networking and protocol progression are out of scope here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: p2pSetup runtime modes > <dynamic: `connects and round-trips contract calls in ${modeLabel}/${vmLabel} mode`>`](../../../../../../test/e2e/E2E-RuntimeTransportModes.test.ts#L141) (line 141) | [`UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P1`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeHost.ts.md#unit-test-p2p-runtime-host-1-tjywgm.p1), [`INV-RUNTIME-1-AKRHAK.T1.P1`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak.t1.p1), [`INV-RUNTIME-1-AKRHAK.T1.P3`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak.t1.p3), [`INV-RUNTIME-1-AKRHAK.T1.P6`](../../../../specification/runtime/execution.md#inv-runtime-1-akrhak.t1.p6) |
| [`E2E: p2pSetup runtime modes > generates a host-owned signer when no secret is supplied`](../../../../../../test/e2e/E2E-RuntimeTransportModes.test.ts#L291) (line 291)                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
