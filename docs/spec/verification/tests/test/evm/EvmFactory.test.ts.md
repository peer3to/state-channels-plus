# EvmFactory.test.ts

Test file: [test/evm/EvmFactory.test.ts](../../../../../../test/evm/EvmFactory.test.ts)
Exercises: [EvmFactory.ts](../../../../implementation/source/src/evm/EvmFactory.ts.md)

## Overview

The first case is a composition regression for bare `createEvm` with no owner: it builds an EVM through
the public factory with one caller-supplied precompile and a record-only logger, then issues two
`runCall`s. It asserts the custom precompile executes once and returns its ABI-encoded value unchanged,
and that a `log(string)` call to `CONSOLE_ADDRESS` still reaches the console precompile.

The trie-size case builds a bare `createEvm` EVM, installs runtime code that stores eight calldata words
in storage slots 0-7, and calls it 51 times with random calldata through `runCall`. It reads the entry
count of the state manager's trie database (the account trie and every storage trie share it) after the
first call and after the last, and asserts the two are equal. Without node pruning the count grows with
every call.

The two pruning-safety cases use the same slot writer through the
[SlotWriterEvm fixture](../../../../../../test/fixtures/SlotWriterEvmFixture.ts) and read slots through a
shallow copy of the EVM's state manager with empty caches, set to the current state root, so only the trie
database answers. The identical-storage case puts the code at two addresses, writes the same random words to
both, rewrites the first five times, then asserts the second reads back the shared words, writes new words
without an exception and reads those back. With `prefixStorageTrieKeys` removed it fails: the second contract
reads all zeros. The revert case commits one write, records the state root, then runs a rewrite between
`evm.journal.checkpoint()` and `evm.journal.revert()`, as `ContractExecutor` simulation does, and asserts the
state root and every slot are the committed ones.

The other cases create real SDK-owned contract executors ([ExecutorOwnerFixture](../../../../../../test/fixtures/node/ExecutorOwnerFixture.ts))
whose manifest loads [RuntimeValuePrecompile](../../../../../../test/fixtures/node/RuntimeValuePrecompile.ts).
That factory throws unless its context owner is the executor root, creates a real SDK probe worker child
under that owner, checks the child is registered there, and returns the fixture's bytes through the
child's real echo endpoint. The inline cases read the live child record in the same realm; the worker case
proves the owner inside the worker because a result can only return when the factory accepted its owner
and its child serves. The disposal cases hold the child's real echo reply with `RuntimeRpcControl`, so an
`executeCall` stays admitted while executor disposal begins, then observe the exact disposal rejection of
the held call and of a deploy and a simulation queued behind it, the rejection text of a late call,
deploy, and simulation, the precompile call count, the identity of repeated disposal promises, and the
child's closed state. The held-call and stuck-call cases never release the held reply before disposal:
they measure that disposal completes in under 2 seconds (the removed wait was 5 seconds), then read the
child's closed state, the call's rejection, the precompile call count, and, for the stuck call, the
executor errors the SDK fixture collected for the host, which must be empty. The three late-completion cases load
[workerAnswerPrecompile](../../../../../../test/fixtures/workerAnswerPrecompile.ts) in a real inline
executor with a call delay of 1.5 seconds, succeeding or (with
`failAfterDelay`) throwing after it. They dispose the executor right after sending the calls, which the
ordered connection admits first; for the queued case a deploy and a simulation wait on the executor mutex
behind the delayed call. The test takes the real executor root from the owner the SDK handed the
precompile factory (`workerAnswerPrecompileOwners`) and wraps that root's `ContractExecutorService.admit`
record-only, restoring it in the same block. The wrapper forwards every operation unchanged and records
each admitted operation's own settlement. The helper awaits disposal, then every caller's outcome, then
the settlement of every admitted operation, so it returns only after the last admitted operation has itself
finished, including the queued simulation that reaches the delayed precompile only after the first call.
Each case asserts the admitted count (1 for the late success, 1 for the late failure, 3 for the queued
case), that each caller's outcome equals exactly `Contract executor shut down before the operation
finished`, and that the host executor error list is empty. No executor, verifier, or transport is
mocked. Hardfork selection and jumpdest
caching are out of scope.

## Tests

- `should execute custom precompiles without disabling the built-in console precompile`: UNIT-TEST-EVM-FACTORY-1-002C8D.P3
- `keeps the trie database the same size while calls rewrite the same storage slots`: UNIT-TEST-EVM-FACTORY-1-002C8D.P4
- `keeps a contract's storage intact while another contract with identical storage rewrites its slots`: UNIT-TEST-EVM-FACTORY-1-002C8D.P5
- `keeps the state root and every slot when a checkpointed call that rewrites the slots is reverted`: UNIT-TEST-EVM-FACTORY-1-002C8D.P6
- `gives a manifest precompile its inline executor root during startup and releases its child with that executor`: UNIT-TEST-EVM-FACTORY-1-002C8D.P1, REQ-RUNTIME-3-VQXW59.T1.P71
- `gives a manifest precompile its worker executor root during startup`: UNIT-TEST-EVM-FACTORY-1-002C8D.P2, REQ-RUNTIME-3-VQXW59.T1.P72
- `rejects an admitted precompile call and its queued deploy and simulation at once and disposes the precompile child`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P1, REQ-RUNTIME-3-VQXW59.T1.P73
- `rejects executor calls, deploys and simulations that arrive after disposal began without entering the EVM`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P2, REQ-RUNTIME-3-VQXW59.T1.P74
- `shares one completion across repeated executor disposal during admitted work`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P4, REQ-RUNTIME-3-VQXW59.T1.P76
- `abandons an admitted call stuck on its precompile at once, closes the child, and reports no error`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P5, REQ-RUNTIME-3-VQXW59.T1.P77
- `keeps the disposal rejection for an admitted call that succeeds after disposal`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6, REQ-RUNTIME-3-VQXW59.T1.P79
- `keeps the disposal rejection for an admitted call that fails after disposal`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P7, REQ-RUNTIME-3-VQXW59.T1.P80
- `rejects queued deploy and simulation callers released after disposal`: UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8, REQ-RUNTIME-3-VQXW59.T1.P81
