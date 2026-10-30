# SignerRecoveryCache.ts

> **Source:** [src/cache/SignerRecoveryCache.ts](../../../../../../src/cache/SignerRecoveryCache.ts)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)
- [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9)
- [`REQ-ID-5-GW1ZEY` (One signature per signer per message)](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey)

## UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP

Contract-parity recovery with a bounded memo

- Setup: Call `recoverSigner` and `isContractAcceptedSignature` directly on real wallet signatures over random digests, with the memo reset before each case; for parity, compare against a deployed `UtilityFacet.retrieveSignerAddress` on the same bytes and every rejected re-encoding of one real signature
- Oracle: Accepted encodings recover the wallet address (equal to `verifyMessage` and to the contract's signer); rejected encodings throw and are refused by the predicate exactly when the contract reports invalid; memo size follows distinct (message, signature) pairs and never exceeds the bound; eviction drops the oldest and never changes a result

- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P1` — an ordinary 65-byte signature recovers the signing wallet's address, equal to `ethers.verifyMessage`
- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P2` — repeated recoveries of one (message, signature) pair keep one memo entry, and a second pair adds a second entry
- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P4` — with `SIGNER_RECOVERY_CACHE_MAX` lowered, inserts past the bound keep the size at the bound, drop the oldest entries first, and the kept entries still resolve to their signers
- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P5` — every contract-rejected encoding class of one real signature (compact 64-byte, `v` of 0/1, EIP-155 `v`, high `s`, zero `r`, zero `s`, `r` at the group order, 66 bytes, 63 bytes, empty) is refused by `isContractAcceptedSignature` and makes `recoverSigner` throw, exactly as the contract's `retrieveSignerAddress` reports invalid, while the ordinary encoding is accepted with the contract's signer
- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P6` — a rejected encoding throws before the memo is read or written: the memo size is unchanged after the throw
- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P7` — the message is part of the key: one signature over two messages recovers, on repeated calls, each message's own signer as the uncached `verifyMessage` does, with two memo entries and one real recovery per message
- [x] `UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P8` — the signature is part of the key: one message signed by two wallets recovers, on repeated calls, each wallet as the uncached `verifyMessage` does, with two memo entries and one real recovery per signature

## UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4

Double-signature reports

- Setup: Call `recoverSigner`, directly or through the `SignatureUtils` join, transaction, dispute and open recovery helpers, with real signatures from random ethers wallets (RFC 6979 and explicit-nonce variants, plus contract-rejected re-encodings); register listeners with `onDoubleSignature`, including a throwing one; lower `SIGNER_RECOVERY_CACHE_MAX` for bound cases.
- Oracle: Recovered address equals the signing wallet and a re-encoding throws; reports carry the signer, message hex and both canonical signatures; no report for identical values, re-encodings, other messages or other signers.

- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P5` — the same signature twice reports nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P6` — a second nonce signature reports the signer, message and both canonical signatures
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P7` — v 0/1 re-encoding is rejected and reports nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P8` — v 35/36 re-encoding is rejected and reports nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P9` — 64-byte compact re-encoding is rejected and reports nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P10` — the 65-byte form after its rejected compact form reports nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P11` — one signer on different messages reports nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P12` — two signers on one message report nothing
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P13` — the canonical-signature memo is bounded
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P14` — a conflict with an evicted entry is unreported while a retained one is reported
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P15` — every registered listener hears a report
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P16` — a removed listener hears no later report
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P17` — a throwing listener neither fails recovery nor starves another listener
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P18` — join recovery reports a nonce-variant signer
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P19` — transaction recovery reports a nonce-variant signer
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P20` — dispute recovery reports a nonce-variant signer
- [x] `UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P21` — open-channel recovery reports a nonce-variant signer
