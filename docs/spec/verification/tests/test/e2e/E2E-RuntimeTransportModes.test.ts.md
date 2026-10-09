# E2E-RuntimeTransportModes.test.ts

Test file: [test/e2e/E2E-RuntimeTransportModes.test.ts](../../../../../../test/e2e/E2E-RuntimeTransportModes.test.ts)

## Overview

The suite proves the `EvmStateMachine.p2pSetup` runtime behaves identically across its four
threading modes. Four explicit tests cover every `RUN_SDK_IN_THREAD` × `VM_DEDICATED_THREAD`
combination. Each test deploys a fresh full stack and drives the same operation battery through
the port-backed `chainSigner` and contract proxies. Four more explicit tests install a real custom
root and prove its delayed `ready()` hook gates `p2pSetup` in inline and worker modes. A rejecting
hook must preserve its error while partial resources close. Two custom-endpoint cases also prove
that handler entry observes the state mutex as unlocked in inline and worker hosts. Four log-collection
cases prove an uncaught error in the sdk thread surfaces as a host error and uploads main too, that
report-a-bug returns what it uploaded and reports a refusing receiver, and that a closed or failed session
removes its root/store registrations from collection. The
battery covers reads (addresses, `getAllTimes`, state, participants), the whole signing surface
(`signMessage` on strings and bytes, `signTypedData`, `signTransaction`, `populateCall`/
`populateTransaction`), concurrent `sendTransaction` calls that must get consecutive nonces and
successful receipts, and failure equivalence: `resolveName` rejects with `UNSUPPORTED_OPERATION`
and a mismatched `from` rejects with `INVALID_ARGUMENT` before any signing happens. The final test
proves `p2pSetup` generates a host-owned signer when no `signerSecret` is supplied and the runtime
still serves contract reads. Oracles are ethers-level recoveries (`verifyMessage`,
`verifyTypedData`, `Transaction.from`) and error codes, so equivalence is judged on observable
results and domain state. Each placement also runs the same real two-peer channel workflow: committed block/state projections, application event set and payloads, request/error identities, and producer-before-event causal order. SDK-owned crash collection and shutdown remain covered separately.

## Tests

- `connects and round-trips contract calls in inline/inline-vm mode`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P1, INV-RUNTIME-1-AKRHAK.T1.P1, INV-RUNTIME-1-AKRHAK.T1.P3, INV-RUNTIME-1-AKRHAK.T1.P6
- `connects and round-trips contract calls in inline/dedicated-vm mode`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P7, INV-RUNTIME-1-AKRHAK.T1.P7
- `connects and round-trips contract calls in worker/inline-vm mode`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P8, INV-RUNTIME-1-AKRHAK.T1.P8
- `connects and round-trips contract calls in worker/dedicated-vm mode`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P9, INV-RUNTIME-1-AKRHAK.T1.P9
- `waits for custom root readiness in inline mode`: REQ-RUNTIME-3-VQXW59.T2.P1, UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P5, UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P5
- `waits for custom root readiness in worker mode`: REQ-RUNTIME-3-VQXW59.T2.P3, UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P7, UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P10
- `enters a custom RPC handler without the state mutex in inline mode`: INTEGRATION-TEST-RPC-5-ACP2QT.P2
- `enters a custom RPC handler without the state mutex in worker mode`: INTEGRATION-TEST-RPC-5-ACP2QT.P3
- `rejects and cleans up failed custom root readiness in inline mode`: REQ-RUNTIME-3-VQXW59.T1.P5, UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P6, UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P6
- `rejects and cleans up failed custom root readiness in worker mode`: REQ-RUNTIME-3-VQXW59.T1.P7, UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P8, UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P11
- `generates a host-owned signer when no secret is supplied`: none
- `uploads both threads when the sdk thread crashes`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P12, REQ-LOG-8-B7VN3J.T1.P4
- `report-a-bug returns its local result and reaches the SDK receiver`: none
- `a closed session releases its roots and detaches its logger service`: none
- `a failed setup releases its roots and detaches its logger service`: UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P13
