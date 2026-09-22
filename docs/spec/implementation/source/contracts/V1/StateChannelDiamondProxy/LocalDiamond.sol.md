# LocalDiamond.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
  Partial: Other mirrored predicates and their state inputs are owned by their respective facets and event handlers.
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
  Partial: [`DEF-3-1XWQ30`](../../../../../audit/open-findings.md#def-3-1xwq30) persistence gap.

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
- [x] `UNIT-TEST-LOCAL-DIAMOND-2-G8M3VQ.P2` — altered nonzero genesis deposits fail
