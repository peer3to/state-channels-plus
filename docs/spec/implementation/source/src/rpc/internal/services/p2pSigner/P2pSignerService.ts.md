# P2pSignerService.ts

> **Source:** [src/rpc/internal/services/p2pSigner/P2pSignerService.ts](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)

## UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM

Serializable discovery control

- Setup: Drive local and client signer lobby joining through the host request union.
- Oracle: Exact topic and options reach the host, invalid or conflicting entry rejects, matching chains into negotiation on the host, the opened result returns, leave reports the matching phase boundary, and disposal settles pending signed client work.

- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P1` — invalid topic or opening options reject before lifecycle change
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P2` — caller topic crosses the port and matching leave returns true
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P3` — selected channel and discovery are mutually exclusive
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P4` — replacement entry cleans and settles the prior active match
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P6` — client join chains matching and negotiation on the host, returns one opened ID, and leaves the topic
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P7` — explicit timeout crosses the port while absent or null remains caller-controlled
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P8` — post-handoff leave returns false and held negotiation continues to open
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P9` — disposal after local signing settles the pending join as cancelled
- [x] `UNIT-TEST-DISCOVERY-RUNTIME-PORT-1-CB5DCM.P10` — a targeted connect returns false while the ordinary lobby remains active; explicit leave settles that lobby and leaves the selected target with NOT_OPENED status
