# localDiamond.ts

> **Source:** [src/utils/localDiamond.ts](../../../../../../src/utils/localDiamond.ts)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md), [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
  Partial: Reachability only — this file cannot show that callers actually use the mirror instead of a local re-implementation; that judgment stays with each calling report.
- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
  Partial: Local mirror only; production manager addresses use `connectStateChannelManager` from [stateChannelManager.ts](stateChannelManager.ts.md).

## UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1

Merged mirror ABI and binding

- Setup: `localDiamondAbi` and `connectLocalDiamond(address, runner)`, both against the generated ABIs alone and against a `LocalDiamond` deployed by the real deployment helper; no hand-written ABI, no stubbed runner
- Oracle: Every fragment of both generated ABIs is present exactly once; a routed selector and a `LocalDiamond`-only selector each encode identically to their own generated interface and each answer on the deployed mirror; a `null` runner yields a read-only binding at the given address; no duplicate-fragment construction error

- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P1` — merged ABI carries every fragment of both generated ABIs
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P2` — a signature declared by both ABIs yields exactly one fragment
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P3` — a routed facet selector encodes through the binding exactly as the interface ABI encodes it
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P4` — a `LocalDiamond`-only selector encodes through the binding exactly as `LocalDiamond`'s own ABI encodes it
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P5` — `connectLocalDiamond` with a `null` runner builds a read-only binding at the given address
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P6` — a routed facet view answers on the deployed mirror through the binding
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P7` — a `LocalDiamond`-only handler executes on the deployed mirror through the binding
- [x] `UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P8` — every manager error appears once in the local ABI
