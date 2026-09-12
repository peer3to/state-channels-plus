# ClientP2pSigner.ts — Source Report

> **Source:** [src/evm/signer/ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Responsibility and observable boundary

The client-side signer facade in isolated deployments: forwards signing, channel and lobby
operations to the host's `p2pSigner` service over the runtime endpoint — the key never leaves the
host. Channel connect takes its options here, validates them before they cross, encodes the
balance, and answers whether this call opened the channel's genesis; joining, topping up, leaving,
cancelling a pending connect, and joining or leaving a lobby answer what the host's signer
returned.

## Key design decisions

1. **Signing requests cross the boundary; keys do not** ([`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)).
2. **Every host call is a request, so a host-side failure reaches the caller.** `setIsLeader` and
   `disconnectFromPeers` return the reply's promise rather than posting and forgetting. Both used to
   return `void`, so an SDK consumer that calls them without awaiting now floats a rejecting promise
   on a host-side failure where it previously got a logged bad frame.
3. **The local leader flag follows the host's ack.** `setIsLeader` assigns it only after the request
   resolves, so a refused call leaves `getIsLeader()` reporting what the host actually has.
4. **Text and bytes are told apart by the encoding, not by how a string looks.** `signMessage` builds
   the tagged `SignerMessage` both host signers take, so the UTF-8 text `"0xdeadbeef"` and the four
   bytes it resembles produce different signatures.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

| Source file                                                                  | Specification IDs                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts) | [`REQ-ID-3-KR0BE3`](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Signing confinement per the identity rules.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [identity.md](../../../../../specification/protocol-model/identity.md), [P2pRuntimeHost](../p2pRuntime/P2pRuntimeHost.ts.md).
