# test/evm/ContractExecutor.test.ts — Test Report

> **Test file:** [test/evm/ContractExecutor.test.ts](../../../../../../../test/evm/ContractExecutor.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                             | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `ContractExecutor > should successfully execute a call to get a value` (line 65)                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should successfully execute a call to set a value` (line 82)                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should successfully set state using bytes` (line 109)                                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should return RPC-style logs` (line 141)                                                                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should simulate a mutating call without persisting it` (line 170)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should not expand the underlying EVM DB on simulated mutating calls` (line 199)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should expand the underlying EVM DB on canonical mutating calls` (line 214)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should make simulations wait while a canonical call holds the mutex` (line 229)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should simulate from the committed state after a canonical call releases` (line 281)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should serialize detached simulations` (line 344)                                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should serialize many detached canonical increments and simulations without corrupting state` (line 382) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should serialize canonical detached calls before entering evm.runCall` (line 461)                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should throw an error for invalid function calls` (line 510)                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `ContractExecutor > should properly decode Solidity revert errors` (line 524)                                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
