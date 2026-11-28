# AConsumerFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol)

## Requirements

- [`REQ-ENFSM-3-JZK0FB` (Genesis derivation)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-3-jzk0fb)
  Partial: `openChannelGenesis` is pure by signature and returns only the encoded state; the manager never runs it and records the hash the signers agreed, so the balance total of the genesis is integrator-owned and checked by no party ([`OQ-19-Y8FDQX` (Channel-balance invariant enforcement points)](../../../../open-questions.md#oq-19-y8fdqx)). Self-containment is integrator-owned too: the SDK runs the hook on a local copy of this facet's code, so a hook that calls another contract, an external linked library included, fails there.
- [`REQ-ENFSM-2-G4HBKG` (Adapter confinement)](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-2-g4hbkg)
  Contradicts: `deposit` and `withdraw` are reachable directly through the proxy `fallback`, not only through manager-owned paths ([`OQ-17-6Z5Q0J` (Consumer-facet functions are externally reachable)](../../../../open-questions.md#oq-17-6z5q0j)).
