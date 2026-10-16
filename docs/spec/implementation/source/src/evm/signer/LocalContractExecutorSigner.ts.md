# LocalContractExecutorSigner.ts

> **Source:** [src/evm/signer/LocalContractExecutorSigner.ts](../../../../../../../src/evm/signer/LocalContractExecutorSigner.ts)

## Requirements

- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)

## UNIT-TEST-LOCAL-CONTRACT-EXECUTOR-SIGNER-1-TN89Z5

Call gas forwarding

- Setup: Wrap a real `ContractExecutor` holding a Math machine in `LocalContractExecutorSigner` and call it with and without a `gasLimit`
- Oracle: A call carrying a `gasLimit` is simulated under that limit (a 1,000-gas call fails); a call without one runs under the executor's own grant

- [x] `UNIT-TEST-LOCAL-CONTRACT-EXECUTOR-SIGNER-1-TN89Z5.P1` — `call` forwards the transaction's `gasLimit` to the executor's simulation
