# LocalContractExecutorSigner.ts

> **Source:** [src/evm/signer/LocalContractExecutorSigner.ts](../../../../../../../src/evm/signer/LocalContractExecutorSigner.ts)

## Requirements

- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)

## UNIT-TEST-LOCAL-CONTRACT-EXECUTOR-SIGNER-1-6BS5C1

Local transactions without chain reads

- Setup: A real local EVM executor behind a signer whose wallet has no provider; two local deploys
- Oracle: Both deploys succeed with distinct local addresses from their receipts; the responses carry the local transaction count (0, 1) as nonce, `getNonce` answers that count (2), and no chain request is made

- [x] `UNIT-TEST-LOCAL-CONTRACT-EXECUTOR-SIGNER-1-6BS5C1.P1` — two local deploys with no provider: both deploy, nonces 0 and 1, then `getNonce` 2
