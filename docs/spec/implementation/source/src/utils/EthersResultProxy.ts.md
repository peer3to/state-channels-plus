# EthersResultProxy.ts

> **Source:** [src/utils/EthersResultProxy.ts](../../../../../../src/utils/EthersResultProxy.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D

Value normalization

- Setup: Pass native, compatible cross-module, proxy-wrapped, normalized, nested, and ordinary array values through `convertEthersValue`
- Oracle: Results become the same named plain object; clean branches and already-normalized values retain identity; ordinary arrays remain ordinary arrays

- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P1` — native and cross-module Result conversion
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P2` — ordinary array rejection and identity preservation
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P3` — proxy-wrapped Result converts once and normalized output is stable
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P4` — recursive array/plain-object conversion with clean-branch identity

## UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC

Contract method boundary

- Setup: Invoke direct and `staticCall` methods with synchronous, asynchronous, nested Result, and rejected values
- Oracle: Inputs and successful outputs normalize once; receiver and method properties survive; rejection identity is unchanged

- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P1` — synchronous direct result
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P2` — asynchronous direct result
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P3` — `staticCall` result
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P4` — direct and static argument conversion
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P5` — method properties and receiver
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P6` — rejection identity

## UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE

Listener lifecycle

- Setup: Register through every supported add verb, emit Result and event-log arguments, then remove through both supported remove verbs, including duplicate registration
- Oracle: Arguments normalize; once/prepend semantics hold; event-log prototype survives; the original callback removes every matching registration one at a time

- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P1` — `on` argument and event-log conversion
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P2` — `once`
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P3` — `addListener`
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P4` — `prependListener`
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P5` — `prependOnceListener`
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P6` — `off` with original callback
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P7` — repeated `removeListener` with original callback

## UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T

Query and passthrough boundary

- Setup: Invoke `queryFilter`, ordinary methods, and ordinary properties through the proxy
- Oracle: Every returned event log normalizes with its prototype intact; non-array query results and unrelated surface members pass through unchanged

- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P1` — event-log array conversion
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P2` — non-array query result passthrough
- [x] `UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P3` — ordinary method/property passthrough
