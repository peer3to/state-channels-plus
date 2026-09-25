# P2pRuntimeHostRoot.ts

> **Source:** [src/rpc/internal/roots/P2pRuntimeHostRoot.ts](../../../../../../../../src/rpc/internal/roots/P2pRuntimeHostRoot.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-IX-8-FY54AV` (Execution equivalence)](../../../../../../specification/interactions.md#req-ix-8-fy54av)
- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../../../specification/storage/queue.md#req-qstore-2-vywjaq)
- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)

## UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM

Host protocol for [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) and [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

- Setup: Drive the request surface inline and workered incl. readiness failures, disposal mid-flight, and signing requests
- Oracle: Equivalent behavior; readiness gates return; every request settles once

- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P1` — inline-SDK/inline-VM baseline
- [ ] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P2` — disposal settlement
- [ ] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P3` — signing confinement probes
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P4` — event forwarding fidelity
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P5` — delayed readiness in inline mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P6` — readiness rejection cleanup in inline mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P7` — inline-SDK/dedicated-VM mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P8` — worker-SDK/inline-VM mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P9` — worker-SDK/dedicated-VM mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P10` — delayed readiness in worker mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P11` — readiness rejection cleanup in worker mode
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P12` — an uncaught error in the sdk thread surfaces as a host error and uploads main as well
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-1-TJYWGM.P13` — a setup that fails releases its roots and application logger descendants while keeping the caller logger and its sibling active; after separate inline discovery cleanup, process crash-listener counts return to baseline

## INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC

Detached contract-executor errors through the runtime port

- Setup: Build a real runtime whose dedicated contract-executor worker is a scripted entry (inline host through `HostContext.createContractExecutor`; sdk-worker host through an outer test worker entry), arm one failure after readiness, and keep calling
- Oracle: Exactly one `hostError` per arm, delivered through `onHostError`, with `eventLoopDelay` for a watchdog trip; the runtime still serves; disposal drains and the worker exits; no starvation retry

- [x] `INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P1` — inline host: a contract-executor watchdog trip is one `hostError` with delay data and the worker keeps serving
- [x] `INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P2` — sdk-worker host: a contract-executor watchdog trip is one `hostError` with delay data and the worker keeps serving
- [x] `INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P3` — inline host: a contract-executor autonomous throw is one `hostError` and the worker keeps serving
- [x] `INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P4` — sdk-worker host: a contract-executor autonomous throw is one `hostError` and the worker keeps serving
- [x] `INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P5` — inline host: a contract-executor unhandled rejection is one `hostError` and the worker keeps serving
- [x] `INTEGRATION-TEST-RUNTIME-DETACHED-ERROR-1-5GWDEC.P6` — sdk-worker host: a contract-executor unhandled rejection is one `hostError` and the worker keeps serving

## UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1

Pre-deployment request dispatch

- Setup: Create a real port and host before deployComplete; each signer/hostRpc request returns the same request ID and Runtime is not ready before payload decode, while deploy signer reads succeed.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P1` — rejects sendTransaction before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P2` — rejects callView before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P3` — rejects connectToChannel before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P4` — rejects cancelConnectToChannel before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P5` — rejects leaveChannel before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P6` — rejects joinLobby before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P7` — rejects leaveLobby before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P8` — rejects joinChannel before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P9` — rejects topUpBalance before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P10` — rejects collectJoinChannelConfirmation before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P11` — rejects getChannelStatus before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P12` — rejects setIsLeader before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P13` — rejects disconnectFromPeers before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P14` — rejects hostRpc before deployment
- [x] `UNIT-TEST-P2P-RUNTIME-HOST-32-V48CB1.P15` — allows deploy signer address reads before deployment
