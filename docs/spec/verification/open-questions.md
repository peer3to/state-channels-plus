# Verification Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved test cases, oracles, environments, permutations, and evidence sufficiency requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                                                         | Question                                                              | Source                 | Affected documents                                                                                                                                                                                                       | Status   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| [`OQ-4-JGDCNX`](open-questions.md#oq-4-jgdcnx)                             | Dispute-reduction order-independence: proof and permutation testing   | Specification analysis | [protocol/disputes.md](../specification/disputes/disputes.md)                                                                                                                                                            | Open     |
| [`OQ-VER-DISCOVERY-1-9JWTRH`](open-questions.md#oq-ver-discovery-1-9jwtrh) | A Foundry test file named `*.test.sol` is invisible to test discovery | Repository analysis    | [tools/shared/test-inventory.js](../tools/shared/test-inventory.js), [test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol](../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol) | Resolved |

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

A Foundry test file used to be named `StateChannelManagerProxyOpen.test.sol`. It declared a real
case (`test_open_duplicateParticipants_reverts`) and Foundry ran it — `foundry.toml` sets
`test = 'test'` and Forge collects any contract under that tree whose functions start with `test` —
but the verification layer could not see it. `TEST_FILE_RE` in
[tools/shared/test-inventory.js](../tools/shared/test-inventory.js) matches `*.t.sol`, not
`*.test.sol`, so the file yielded no discovered declarations, had no report under
`verification/tests/`, and appeared in neither the coverage report nor the change-impact analysis.
Every one of its siblings in that directory already used `.t.sol`.

The consequence was a silent hole rather than a visible gap: real executed evidence existed and no
maintained document could claim it, and a future case added to that file would inherit the same
invisibility.

Two directions were put to the engineer — rename the file, or widen `TEST_FILE_RE` to bless both
spellings.

**Resolved (2026-08-28, engineer decision):** rename the file. It restores the directory's
convention and makes the case discoverable with no tooling change, whereas widening the pattern
would have left two spellings for the same thing. `TEST_FILE_RE` is unchanged.

The file is now
[test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol](../../../test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol),
its declaration is inventoried in
[StateChannelManagerProxyOpen.t.sol.md](tests/test/V1/StateChannelDiamondProxy/StateChannelManagerProxyOpen.t.sol.md),
and its evidence is assigned to
[`UNIT-TEST-MANAGER-PROXY-1-NTYR71.P12`](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-1-ntyr71.p12).
The parallel runner keeps its extension-agnostic Solidity discovery, so no runner behaviour changed;
the `.test.sol` case in `test/scripts/e2eParallelForgeTasks.test.ts` now uses a synthetic fixture
instead of this repository file. `yarn spec:impact` no longer reports the file as unmapped.
