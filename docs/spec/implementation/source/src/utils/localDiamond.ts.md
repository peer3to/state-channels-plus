# localDiamond.ts

> **Source:** [src/utils/localDiamond.ts](../../../../../../src/utils/localDiamond.ts)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)

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

## UNIT-TEST-PREFER-LOCAL-1-XC95T6

Local-first read with chain fallback

- Setup: `preferLocal(local, onChain, acceptLocal)` with counting local and chain reads and a boolean acceptance rule; the local failure is a revert as the local signer surfaces it (synthetic, or a real `ContractExecutor` call through `LocalContractExecutorSigner`), a plain non-revert error, a real signer failure, or a non-`Error` thrown value; the chain read or the acceptance rule may also fail
- Oracle: The returned answer or rejection and the number of chain reads: an accepted local answer returns with zero chain reads; a rejected answer returns the chain's answer after exactly one chain read; every local failure including a revert and an acceptance-rule failure reject with that same error and zero chain reads; a chain-read failure rejects with that failure

- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P1` — accepted local answer kept without a chain read
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P2` — rejected local answer replaced by the chain's answer
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P4` — non-revert local failure propagates without a chain read
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P5` — the chain read that confirms a rejected local answer fails: that failure propagates
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P8` — a real local signer call that never reaches the EVM fails without the revert marker and propagates with no chain read
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P10` — the acceptance rule throws: that failure propagates with no chain read
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P11` — a local EVM revert propagates as the same error with zero chain reads
- [x] `UNIT-TEST-PREFER-LOCAL-1-XC95T6.P12` — a real contract call reverting in the local executor propagates as the same error with zero chain reads
