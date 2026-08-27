# Verification Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved test cases, oracles, environments, permutations, and evidence sufficiency requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                             | Question                                                            | Source                 | Affected documents                                            | Status |
| ---------------------------------------------- | ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------- | ------ |
| [`OQ-4-JGDCNX`](open-questions.md#oq-4-jgdcnx) | Dispute-reduction order-independence: proof and permutation testing | Specification analysis | [protocol/disputes.md](../specification/disputes/disputes.md) | Open   |
| [`OQ-VER-DISCOVERY-1-9JWTRH`](open-questions.md#oq-ver-discovery-1-9jwtrh) | A Foundry test file named `*.test.sol` is invisible to test discovery | Repository analysis | [tools/shared/test-inventory.js](../tools/shared/test-inventory.js), [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.test.sol](../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.test.sol) | Open   |

<a id="oq-4-jgdcnx"></a>

## OQ-4-JGDCNX — Dispute-reduction order-independence

Reduction is intended to converge to the same result regardless of the order in which valid
dispute inputs are applied, even though the chain serializes transactions. The exact merge/
reduction rules and a proof that conflicting orderings cannot change the result are not yet
specified, and the property is not yet verified by permutation, adversarial, and on-chain
integration tests. Until then it MUST NOT be described as CRDT-like.

Code-derived sharpening: order independence is currently violated in principle. Killing a
commitment removes it by swap-with-last, reordering the survivor set that `reduce()` consumes
positionally, and order-sensitive consumers exist (slash application order can change the
serialized output state and therefore the successor `forkId`; the empty-timeout fold of [`OQ-14-5C8KV7`](../implementation/open-questions.md#oq-14-5c8kv7) is
last-writer-wins). Candidate directions: canonicalize (sort) the survivor set before reduction,
or prove and permutation-test independence including kills and slash-application order. See
[protocol/disputes.md](../specification/disputes/disputes.md) §5 ([`INV-DIS-5-J1QZ92`](../specification/disputes/disputes.md#inv-dis-5-j1qz92)).

<a id="oq-ver-discovery-1-9jwtrh"></a>

## OQ-VER-DISCOVERY-1-9JWTRH — A Foundry test file named `*.test.sol` is invisible to test discovery

`test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.test.sol` declares a real Foundry
case (`test_open_duplicateParticipants_reverts`) and Foundry runs it: `foundry.toml` sets
`test = 'test'` and Forge collects any contract under that tree whose functions start with `test`.
The verification layer cannot see it. `TEST_FILE_RE` in
[tools/shared/test-inventory.js](../tools/shared/test-inventory.js) matches `*.t.sol`, not
`*.test.sol`, so the file yields no discovered declarations, has no report under
`verification/tests/`, and appears in neither the coverage report nor the change-impact analysis.
Every one of its seven siblings in that directory uses `.t.sol`.

The consequence is a silent hole rather than a visible gap: real executed evidence exists and no
maintained document can claim it, and a future case added to that file inherits the same
invisibility.

Engineer decision requested — the two directions are not equivalent:

1. **Rename the file to `StateChannelManagerProxyOpen.t.sol`** (a repository change outside this
   tree). It restores the directory's convention, makes the file discoverable with no tooling
   change, and then requires a verification report with a row per declaration. Preferred by the
   surrounding convention, but it is a code change an agent must not make unilaterally.
2. **Widen `TEST_FILE_RE` to accept `*.test.sol`.** No repository change, and it is strictly
   stricter (it adds an obligation rather than hiding one), but it blesses two spellings for the
   same thing and leaves the naming inconsistency in place.

Blocking effect: until it is resolved, `yarn spec:impact` reports this file as an unmapped changed
file whenever it is touched, and its evidence stays unassignable.
