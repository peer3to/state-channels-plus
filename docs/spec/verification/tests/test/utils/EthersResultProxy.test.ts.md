# EthersResultProxy.test.ts

Test file: [test/utils/EthersResultProxy.test.ts](../../../../../../test/utils/EthersResultProxy.test.ts)
Exercises: [EthersResultProxy.ts](../../../../implementation/source/src/utils/EthersResultProxy.ts.md)

## Overview

The suite exercises the complete public normalization proxy. It covers recursive standalone value
conversion, direct and static contract calls, synchronous and asynchronous results, input
conversion, method receiver and metadata preservation, unchanged rejection propagation, every
supported listener registration/removal verb, duplicate listener removal, event-log prototype
preservation, query-filter conversion, and unrelated member passthrough.

## Tests

A row lists only test IDs this test covers **in full**. Each permutation is assigned to at most one
test declaration.

- `recursively converts Results in arrays and plain objects while retaining clean branches`: UNIT-TEST-ETHERS-RESULT-PROXY-1-1BRJ8D.P4
- `converts a synchronous direct method result`: UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P1
- `converts an asynchronous direct method result`: UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P2
- `converts a staticCall result`: UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P3
- `converts Result arguments before direct and static calls`: UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P4
- `preserves method properties and invokes wrapped calls with the contract receiver`: UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P5
- `propagates a wrapped method rejection unchanged`: UNIT-TEST-ETHERS-RESULT-PROXY-2-RA8YEC.P6
- `converts on listener arguments and preserves event-log identity fields`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P1
- `keeps once listener semantics while converting arguments`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P2
- `converts addListener arguments`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P3
- `keeps prependListener ordering while converting arguments`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P4
- `keeps prependOnceListener ordering and one-shot semantics`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P5
- `removes an on listener through its original callback`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P6
- `removes repeated registrations through the original callback`: UNIT-TEST-ETHERS-RESULT-PROXY-3-B08XRE.P7
- `converts every event log returned by queryFilter`: UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P1
- `returns a non-array queryFilter result unchanged`: UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P2
- `passes ordinary methods and non-function properties through`: UNIT-TEST-ETHERS-RESULT-PROXY-4-4YKW7T.P3
