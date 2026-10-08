# LocalDiamondBinding.test.ts

Test file: [test/unit/LocalDiamondBinding.test.ts](../../../../../../test/unit/LocalDiamondBinding.test.ts)
Exercises: [localDiamond.ts](../../../../implementation/source/src/utils/localDiamond.ts.md)

## Overview

Six pure cases over the client binding for the local mirror — no chain, no harness session, no
deployment. They use the two real generated ABIs (`LocalDiamond__factory.abi` and
`StateChannelManagerInterface__factory.abi`) and the module's own exports, so a change to either
Solidity surface flows into the assertions through typechain.

The first two cases are the merge contract: every `type:sighash` fragment key of both generated
ABIs is present in `localDiamondAbi`, and no key appears twice. Together they pin exactly what the
de-duplication must guarantee — completeness and uniqueness — without asserting which of two
signature-identical fragments survives, which is not observable.

The third case proves every generated manager error appears exactly once. The next two are the
reason the merge exists: a selector the proxy routes to a facet
(`getStateSnapshot`, absent from `LocalDiamond`'s own ABI) and a selector only `LocalDiamond`
declares (`getTotalDeposits`) both encode through the binding, byte-identical to the encoding
produced by their own generated interface. The last case pins the read-only construction path: a
`null` runner yields a binding whose `target` is the given address and whose `runner` is `null`.

Scope limit: nothing here calls the mirror. The address is a placeholder, so the suite proves the
ABI the binding carries, not that the deployed mirror answers it — that half is
`test/V1/UniversalDeployment.test.ts`, which drives real routed and `LocalDiamond`-only calls
through `connectLocalDiamond` against a deployed mirror.

## Tests

- `carries every fragment of both generated ABIs`: UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P1
- `keeps one fragment for a signature declared by both ABIs`: UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P2
- `includes every manager error once`: UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P8
- `encodes a call to a function the proxy routes to a facet`: UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P3
- `encodes a call to a function only the local diamond declares`: UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P4
- `connects a read-only binding when no runner is given`: UNIT-TEST-LOCAL-DIAMOND-BINDING-1-W8ATC1.P5
