# LocalDiamond.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
  Partial: [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) persistence gap.
- [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)

## UNIT-TEST-LOCAL-DIAMOND-1-PJE47M

Mirror replication

- Setup: Replay event sequences incl. duplicates and the open event
- Oracle: Idempotent convergence with on-chain state; [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) documented

- [x] `UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P1` — event replay convergence
- [x] `UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P2` — duplicate idempotence
- [ ] `UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P3` — onChannelOpened (documents [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30))

## UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ

Genesis deposit mirror

- Setup: Audit honest and altered disputes after a channel opens with nonzero deposits
- Oracle: Honest replay passes the balance invariant; changing the deposit total produces the matching fraud proof

- [x] `UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P1` — honest nonzero genesis deposits pass
- [ ] `UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P2` — altered nonzero genesis deposits fail

## UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5

Gas-capped dispute computation

- Setup: Deploy a local diamond with a chosen dispute execution gas limit over a seeded state and call the dispute output computations
- Oracle: An exhausted budget reverts `ErrorDisputeExecutionOutOfGas`, never an empty revert or a result; within the budget the result is the facet's own and the output snapshot lists the output state's participants

- [x] `UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P1` — a budget too small for the computation reverts `ErrorDisputeExecutionOutOfGas`
- [x] `UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P2` — within the default budget `computeDisputeOutputSnapshotData` hashes the state `computeDisputeOutputState` returns and lists the participants of that output state (a removed participant is gone, order kept)
- [x] `UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P3` — a facet failure with revert data inside the budget is re-thrown with that data unchanged
- [x] `UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P4` — an out-of-gas inside a nested state-machine call, where the facet keeps the 1/64 of the forwarded gas it did not pass on, reverts `ErrorDisputeExecutionOutOfGas`
- [x] `UNIT-TEST-LOCAL-DIAMOND-3-H2MQE5.P5` — an empty revert inside the budget stays an empty revert and is not relabeled `ErrorDisputeExecutionOutOfGas`
