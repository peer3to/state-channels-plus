# ContractErrors.test.ts

Test file: [test/utils/ContractErrors.test.ts](../../../../../../test/utils/ContractErrors.test.ts)
Exercises: [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md), [StateChannelManagerProxy.sol](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md)

## Overview

The suite exercises the custom-EVM-error path at three levels. First, it sanity-checks
`GeneratedArtifacts`: `artifacts` load with abi/contractName/bytecode, include every canonical
routed facet, and `errorAbis` contains only `type: "error"` entries (the ABI set
`evmErrorHandler`'s parser is built from). It also proves the union contains all three reachable ECDSA errors and decodes
`ECDSAInvalidSignatureS(bytes32)`. Second, it
drives `tryDecodeCustomError`/`tryHandleEvmError` with synthetic errors whose revert data is
encoded from each error's own ABI fragment: five named race-condition/error selectors — a mix of
argument-less and argument-bearing errors — decode to the right `errorDescription.name`, a plain
`Error` with no revert data returns `null` and passes through unchanged, and a registered handler
receives the `CustomEvmError` wrapping the original error.
Third, real hardhat calls through `deployMathChannelProxyFixture` hit `postBlockCalldata` and
decode genuine on-chain reverts (`ErrorBlockCalldataMsgSenderNotBlockAuthor`,
`RaceConditionBlockCalldataTimestampTooLate`, `ErrorBlockCalldataAlreadyPosted`) plus one success
case. Two of those reverts are asserted operand by operand. The wrong-author case posts a block
authored by the second hardhat account from the first, so `expectedAuthor` and `actualSender` are
different accounts and a swapped pair fails. The duplicate-post case posts a block carrying a
distinctive fork id and transaction count `7`, then re-posts it; the payload must name that fork
id, that transaction count, the posting account, and the commitment stored by the FIRST post,
which the test derives itself as `keccak256(abi.encode(signedBlock, postTimestamp))` from the
mined timestamp rather than reading it back out of the contract. A fourth group covers the `encodedCustomErrorRevert` test helper that builds that revert
data: an argument-less error encodes to a bare 4-byte selector, an argument-bearing error encodes
one zero value per declared parameter, and an unknown error name throws. Those three declarations
cover the helper itself, not `evmErrorHandler`, so they carry no permutation.
`UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF` now defines one permutation per named error; the five
names this suite decodes are assigned. The distinctive `.P2`/`.P3` scenarios — revert data with
an unknown selector and malformed revert data — still have no dedicated test (the plain-`Error`
case exercises the missing-data guard, a different path), and the remaining named-error
permutations are undecoded here. `ErrorDisputeAlreadyPosted`, `ErrorBlockCalldataAlreadyPosted`,
and `ErrorBlockCalldataMsgSenderNotBlockAuthor` have no permutation in that pool; the payload
obligations for the latter two belong to the guards that raise them and are recorded as
`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P14`
and
`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P15`.

## Tests

- `should load all required facet artifacts`: none
- `should extract error ABIs from artifacts`: none
- `includes every routed facet in generated artifacts`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P30
- `includes every ECDSA error reachable through manager facets`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P28
- `decodes ECDSAInvalidSignatureS with its argument`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P29
- `should decode  contract errors correctly`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P7, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P13, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P20
- `should pass through regular errors unchanged`: none
- `passes the decoded custom error to its handler`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P11
- `should handle postBlockCalldata success case`: none
- `should handle ErrorBlockCalldataMsgSenderNotBlockAuthor custom error`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P15
- `should handle RaceConditionBlockCalldataTimestampTooLate custom error`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P4
- `should handle ErrorBlockCalldataAlreadyPosted custom error`: UNIT-TEST-MANAGER-PROXY-1-NTYR71.P14
- `encodes an argument-less error as its bare selector`: none
- `encodes an argument-bearing error with a zero value per parameter`: none
- `throws for a name that is not a contract error`: none
