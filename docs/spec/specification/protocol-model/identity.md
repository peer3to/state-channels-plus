# Participant Identity and Signing

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** What a participant identity is, how signatures bind statements to it, how identities
> are compared, and where signing authority may live. Every signed object's _meaning_ stays with
> its owning document; this document owns the identity and signature machinery they all share.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Identity](#identity)
- [Signatures](#signatures)
- [Signing authority](#signing-authority)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

Every protocol role — block author, confirmation signer, threshold member, disputer, joiner,
authenticated peer, slash target — is an _identity_, and every protocol commitment is a _signature_
binding a statement to one. The protocol never authenticates people, machines, or transports; it
authenticates key control. An identity that signs is, for every protocol purpose, the participant.

## Identity

A participant identity is an account address derived from an asymmetric key pair under the
signature scheme of the connected chain's account model. For the current deployment target that is
Ethereum-style: a secp256k1 ECDSA key pair whose address is the last 20 bytes of the Keccak-256
hash of the uncompressed public key.

- **Sameness.** Two identities are the same participant iff their normalized addresses are equal.
  Comparison MUST normalize case (checksum encodings are display conventions, not distinct
  identities); every identity-keyed structure — participant sets, profiles, exclusion lists,
  attribution records, storage keys — keys by the normalized form.
- **Scope.** One address is one participant within a channel. The same address on the base layer
  and in the channel is the same participant: deposits, joins, exits, and slashes all bind
  channel-level identity to base-layer accountability through it.
- **No aliasing.** The protocol defines no linkage between two addresses; a person operating two
  addresses is two participants, with two stakes and two accountability chains.

## Signatures

A protocol signature binds a statement's canonical bytes to an identity with public-key recovery:
given the message and signature, verification yields the signer's address without any prior key
exchange. That recovery property is load-bearing — threshold checks, fraud proofs, and dispute
audit all verify by recovering and comparing addresses, on-chain and off-chain identically.

Two signing forms exist, deliberately incapable of colliding:

1. **Protocol objects** (blocks, transactions, opens, joins, disputes): a signature over the
   Keccak-256 hash of the object's canonical encoding
   ([data-types.md](./data-types.md)), applied under the chain account model's standard
   message-signing envelope (EIP-191 for the current target). The signed target is always the
   32-byte hash of canonical bytes — never a re-serialization, never a display form.
2. **Session authentication**: a signature over a _domain-tagged string_ incorporating a fresh
   challenge ([handshake.md](../peer-communication/handshake.md), [`INV-AUTH-2-VQ6D54`](../peer-communication/handshake.md#inv-auth-2-vq6d54)). The domain tag
   guarantees a session signature can never be replayed as a protocol-object signature even when
   the challenge is chosen adversarially to equal an object hash.

The current protocol-object form carries no domain separation of its own — no chain, deployment,
version, or object-type binding beyond the struct shape. Cross-deployment and cross-chain replay
of such signatures is a known open decision, not an accepted design:
[`OQ-29-EFY4NF`](../open-questions.md#oq-29-efy4nf).

## Signing authority

The private key is the one secret whose compromise is total: assumption A2 of the
[trust model](../security/trust-model.md) makes key privacy a protocol assumption, and a
compromised key _is_ the compromised participant — there is no in-protocol revocation, rotation,
or recovery in this version.

Signing authority is therefore a confined capability, not ambient data:

- Exactly one trusted component of the participant's runtime holds it and performs all signing;
  in an isolated deployment that is the runtime host context, and the key or a signing oracle for
  it never crosses to less-trusted contexts ([execution.md](../runtime/execution.md)).
- No peer-reachable surface exposes signing: nothing a remote peer sends may return a signature,
  except through an endpoint whose _specified contract_ is to sign a validated statement (the
  handshake response, join countersigning, block confirmation) — each such endpoint validates
  before signing under its own document's rules.
- Everything signed is either locally produced or fully validated; the signer is never an oracle
  over unvalidated input ([`REQ-AUTH-1-RF901K`](../peer-communication/handshake.md#req-auth-1-rf901k) is the pattern).

## Requirements and invariants

**[`INV-ID-1-B4FXJ4`](identity.md#inv-id-1-b4fxj4) — Key control is identity.** A valid signature recovering to an address is, for every
protocol purpose, an act of that participant. No protocol rule may distinguish "the participant"
from "whoever controls the key"; consequently key compromise is participant compromise, with no
in-protocol recovery in this version.

**<a id="req-id-1-3q2kb9"></a>`REQ-ID-1-3Q2KB9` — Recoverable signatures over canonical targets.** Protocol signatures MUST support
public-key recovery, and MUST be made over the 32-byte hash of the object's canonical encoding
under the chain account model's standard signing envelope. On-chain and off-chain verification of
the same (message, signature) pair MUST recover the same address.

**<a id="req-id-2-f3y8j4"></a>`REQ-ID-2-F3Y8J4` — Normalized identity comparison.** Every identity comparison and identity-keyed
structure MUST use the normalized address form; case or checksum variance MUST NOT create distinct
identities or miss a match.

**<a id="req-id-3-kr0be3"></a>`REQ-ID-3-KR0BE3` — Confined signing authority.** One trusted runtime component holds the key and signs;
signing capability never crosses to less-trusted execution contexts or peer-reachable surfaces,
and every remotely triggered signature is produced only by an endpoint whose contract specifies
validation-before-signing.

**<a id="req-id-4-bnekcm"></a>`REQ-ID-4-BNEKCM` — Domain-separated signing forms.** Session-authentication signatures MUST be
domain-tagged such that they cannot verify as any protocol-object signature, and vice versa,
regardless of adversarially chosen content. (Extending domain separation across protocol objects,
chains, and deployments is [`OQ-29-EFY4NF`](../open-questions.md#oq-29-efy4nf).)

## Assumptions and constraints

- The chain account model supplies the curve, hash, address derivation, and signing envelope; this
  document binds the protocol to _a_ recoverable scheme and fixes the target and comparison rules,
  not the mathematics.
- Key generation, custody, backup, and hardware isolation are the participant's operational
  concern; the protocol sees only signatures.
- One stable key per participant per channel for this version: no rotation, session keys,
  delegation, or multi-signature identities. A watchtower delegate acts with its _own_ identity
  and authorization, never with the participant's key.

## Security considerations

Protected asset: the binding between statements and accountability. Threats: key theft (total by
<a id="inv-id-1-b4fxj4"></a>`INV-ID-1-B4FXJ4` — mitigations are operational, plus the economic bound of trust-model A5); signing-oracle
abuse (an endpoint tricked into signing attacker-shaped content — contained by [`REQ-ID-3-KR0BE3`](identity.md#req-id-3-kr0be3)/
[`REQ-ID-4-BNEKCM`](identity.md#req-id-4-bnekcm) and per-endpoint validation); identity-comparison bugs (a checksum-variant address
slipping past an exclusion list or splitting attribution — [`REQ-ID-2-F3Y8J4`](identity.md#req-id-2-f3y8j4)); cross-context replay of
protocol-object signatures (open, [`OQ-29-EFY4NF`](../open-questions.md#oq-29-efy4nf)); and malleability of the signature encoding (verification
MUST NOT treat two encodings of one signature as two distinct commitments where uniqueness
matters, e.g. counting threshold signatures).

## Verification and test plan

### Requirement test matrix

| Plan item                                           | Requirements / invariants                        | Setup and stimulus                                                                                                                           | Expected result                                                                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-id-1-b4fxj4.t1"></a>`INV-ID-1-B4FXJ4.T1` | [`INV-ID-1-B4FXJ4`](identity.md#inv-id-1-b4fxj4) | Perform each protocol role's signed action with the registered key and with a different key.                                                 | Recovery decides everything: the registered key's signatures act as the participant; any other key's do not, regardless of claimed identity fields. | <a id="inv-id-1-b4fxj4.t1.p1"></a>`INV-ID-1-B4FXJ4.T1.P1` — signed block accepted from the key holder; <a id="inv-id-1-b4fxj4.t1.p2"></a>`INV-ID-1-B4FXJ4.T1.P2` — claimed-identity fields cannot override recovery; <a id="inv-id-1-b4fxj4.t1.p3"></a>`INV-ID-1-B4FXJ4.T1.P3` — a "stolen key" signature is indistinguishable and accepted (documenting the compromise model); <a id="inv-id-1-b4fxj4.t1.p4"></a>`INV-ID-1-B4FXJ4.T1.P4` — signed transaction accepted from the key holder; <a id="inv-id-1-b4fxj4.t1.p5"></a>`INV-ID-1-B4FXJ4.T1.P5` — signed open accepted from the key holder; <a id="inv-id-1-b4fxj4.t1.p6"></a>`INV-ID-1-B4FXJ4.T1.P6` — signed join accepted from the key holder; <a id="inv-id-1-b4fxj4.t1.p7"></a>`INV-ID-1-B4FXJ4.T1.P7` — signed dispute accepted from the key holder.                                                                                                                       |
| <a id="req-id-1-3q2kb9.t1"></a>`REQ-ID-1-3Q2KB9.T1` | [`REQ-ID-1-3Q2KB9`](identity.md#req-id-1-3q2kb9) | Verify identical (message, signature) pairs on-chain and off-chain, including tampered messages and signatures.                              | Same recovered address everywhere; tampering changes or invalidates recovery; targets are the canonical-encoding hash only.                         | <a id="req-id-1-3q2kb9.t1.p1"></a>`REQ-ID-1-3Q2KB9.T1.P1` — on-/off-chain recovery agreement for blocks; <a id="req-id-1-3q2kb9.t1.p2"></a>`REQ-ID-1-3Q2KB9.T1.P2` — tampered message; <a id="req-id-1-3q2kb9.t1.p3"></a>`REQ-ID-1-3Q2KB9.T1.P3` — non-canonical re-encoding fails verification; <a id="req-id-1-3q2kb9.t1.p4"></a>`REQ-ID-1-3Q2KB9.T1.P4` — malleated signature encoding not double-counted; <a id="req-id-1-3q2kb9.t1.p5"></a>`REQ-ID-1-3Q2KB9.T1.P5` — on-/off-chain recovery agreement for transactions; <a id="req-id-1-3q2kb9.t1.p6"></a>`REQ-ID-1-3Q2KB9.T1.P6` — on-/off-chain recovery agreement for opens; <a id="req-id-1-3q2kb9.t1.p7"></a>`REQ-ID-1-3Q2KB9.T1.P7` — on-/off-chain recovery agreement for joins; <a id="req-id-1-3q2kb9.t1.p8"></a>`REQ-ID-1-3Q2KB9.T1.P8` — on-/off-chain recovery agreement for disputes; <a id="req-id-1-3q2kb9.t1.p9"></a>`REQ-ID-1-3Q2KB9.T1.P9` — tampered signature. |
| <a id="req-id-2-f3y8j4.t1"></a>`REQ-ID-2-F3Y8J4.T1` | [`REQ-ID-2-F3Y8J4`](identity.md#req-id-2-f3y8j4) | Exercise identity-keyed structures (participant sets, exclusions, attribution, storage keys) with case/checksum variants of one address.     | All variants resolve to one identity in every structure.                                                                                            | <a id="req-id-2-f3y8j4.t1.p1"></a>`REQ-ID-2-F3Y8J4.T1.P1` — participant sets with variant addresses; <a id="req-id-2-f3y8j4.t1.p2"></a>`REQ-ID-2-F3Y8J4.T1.P2` — variant on the write side; <a id="req-id-2-f3y8j4.t1.p3"></a>`REQ-ID-2-F3Y8J4.T1.P3` — exclusion cannot be evaded by recasing; <a id="req-id-2-f3y8j4.t1.p4"></a>`REQ-ID-2-F3Y8J4.T1.P4` — exclusion lists with variant addresses; <a id="req-id-2-f3y8j4.t1.p5"></a>`REQ-ID-2-F3Y8J4.T1.P5` — attribution records with variant addresses; <a id="req-id-2-f3y8j4.t1.p6"></a>`REQ-ID-2-F3Y8J4.T1.P6` — storage keys with variant addresses; <a id="req-id-2-f3y8j4.t1.p7"></a>`REQ-ID-2-F3Y8J4.T1.P7` — variant on the read side.                                                                                                                                                                                                                                      |
| <a id="req-id-3-kr0be3.t1"></a>`REQ-ID-3-KR0BE3.T1` | [`REQ-ID-3-KR0BE3`](identity.md#req-id-3-kr0be3) | Enumerate remotely reachable surfaces and isolated-context boundaries; attempt to obtain signatures outside the specified signing endpoints. | Only the specified endpoints sign, each only after its validation; no key or signing capability crosses a context or peer boundary.                 | <a id="req-id-3-kr0be3.t1.p1"></a>`REQ-ID-3-KR0BE3.T1.P1` — surface enumeration finds only specified signers; <a id="req-id-3-kr0be3.t1.p2"></a>`REQ-ID-3-KR0BE3.T1.P2` — handshake-response endpoint validates before signing; <a id="req-id-3-kr0be3.t1.p3"></a>`REQ-ID-3-KR0BE3.T1.P3` — isolated context cannot request raw signing; <a id="req-id-3-kr0be3.t1.p4"></a>`REQ-ID-3-KR0BE3.T1.P4` — join-countersigning endpoint validates before signing; <a id="req-id-3-kr0be3.t1.p5"></a>`REQ-ID-3-KR0BE3.T1.P5` — block-confirmation endpoint validates before signing.                                                                                                                                                                                                                                                                                                                                                           |
| <a id="req-id-4-bnekcm.t1"></a>`REQ-ID-4-BNEKCM.T1` | [`REQ-ID-4-BNEKCM`](identity.md#req-id-4-bnekcm) | Craft session challenges equal to protocol-object hashes and protocol objects shaped like domain-tagged strings.                             | Neither form's signature verifies as the other, in any direction.                                                                                   | <a id="req-id-4-bnekcm.t1.p1"></a>`REQ-ID-4-BNEKCM.T1.P1` — challenge = object hash; <a id="req-id-4-bnekcm.t1.p2"></a>`REQ-ID-4-BNEKCM.T1.P2` — object mimicking the tagged string; <a id="req-id-4-bnekcm.t1.p3"></a>`REQ-ID-4-BNEKCM.T1.P3` — block signature against the session verifier; <a id="req-id-4-bnekcm.t1.p4"></a>`REQ-ID-4-BNEKCM.T1.P4` — transaction signature against the session verifier; <a id="req-id-4-bnekcm.t1.p5"></a>`REQ-ID-4-BNEKCM.T1.P5` — open signature against the session verifier; <a id="req-id-4-bnekcm.t1.p6"></a>`REQ-ID-4-BNEKCM.T1.P6` — join signature against the session verifier; <a id="req-id-4-bnekcm.t1.p7"></a>`REQ-ID-4-BNEKCM.T1.P7` — dispute signature against the session verifier.                                                                                                                                                                                            |

## Future Work

_Non-normative._ Domain separation for protocol objects (chain, deployment, version, object type —
[`OQ-29-EFY4NF`](../open-questions.md#oq-29-efy4nf)) and its proof-migration plan; key rotation or session-key delegation with explicit
revocation semantics; multi-signature or smart-account participant identities; watchtower
delegation credentials distinct from participant keys.
