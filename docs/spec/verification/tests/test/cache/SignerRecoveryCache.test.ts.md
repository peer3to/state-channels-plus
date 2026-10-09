# SignerRecoveryCache.test.ts

Test file: [test/cache/SignerRecoveryCache.test.ts](../../../../../../test/cache/SignerRecoveryCache.test.ts)
Exercises: [SignerRecoveryCache.ts](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md)

## Overview

The suite calls `recoverSigner` and `isContractAcceptedSignature` directly, with the memo reset
before each test; shared signing helpers live in `test/fixtures/RecoveryCacheFixture.ts` and
`test/fixtures/SignatureEncodingFixture.ts`. A record-only observer (`recordSignerRecoveries`)
lists the digests the memo lets through to a real recovery. The first four tests use real wallet
signatures over random 32-byte messages: the recovered address equals both the wallet address and
`ethers.verifyMessage`; repeated recoveries of one pair keep one memo entry and a second pair adds
one. Two tests isolate each half of the key against the uncached `verifyMessage` oracle, each
calling twice: one signature over two messages recovers each message's own signer (a different
address for the second message), and one message signed by two wallets recovers each wallet; both
end with two memo entries and exactly one real recovery per distinct pair. With `SIGNER_RECOVERY_CACHE_MAX` lowered to 3,
the eviction test checks by the recorded recoveries that a hit does not refresh an entry, that the
oldest insert is evicted first, and that an evicted pair recovers its signer again (the bound is
restored in `finally`). The rejection test recovers an ordinary signature once, then feeds all ten
contract-rejected re-encodings of it: each throws "signature is not accepted by the contracts",
the memo size stays 1, and no rejected encoding reaches a real recovery.

The parity test deploys a real `UtilityFacet` and takes one wallet signature over
`keccak256(encodedData)`, the digest blocks are signed over, in the ordinary encoding and in every
contract-rejected re-encoding from `SignatureEncodingFixture` (compact 64-byte, `v` of 0/1,
EIP-155 `v`, high `s`, zero `r`, zero `s`, `r` at the group order, 66 bytes, 63 bytes, empty). For
each it compares the contract's `retrieveSignerAddress` verdict and signer with
`isContractAcceptedSignature` and `recoverSigner` (a throw counts as no signer), and pins the full
verdict table: only the ordinary encoding is accepted. This is the differential parity test the
signature carve-out requires.

The double-signature cases register listeners with `onDoubleSignature` and remove them in
`finally`. A second signature is a real signature by the same key made with an explicit different
nonce (`signBlockVariant`); re-encodings are the v 0/1, v 35/36 and 64-byte compact forms of one
real signature, which the contracts reject: each must throw before the memo and report nothing. The oracles are the exact report contents (signer, message hex, both canonical
signatures) or the absence of any report, the canonical-memo size under a lowered bound, and which
listener heard which report. Kind-specific cases sign a factory-built join, transaction, dispute or
open with the SDK's `SignatureUtils` signing helper, add a nonce variant over the same encoding, and
recover both through the matching `SignatureUtils` recovery helper. A throwing listener must leave
recovery and the other listener intact, and signing one block or join twice through the SDK path must
give identical bytes. The bound tests restore the global size setting in `finally`.

## Tests

- `recovers the correct signer (matches verifyMessage)`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P1
- `memoizes by (message, signature) — repeats add no entries`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P2
- `keys on the message — one signature over two messages recovers each message's own signer`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P7
- `keys on the signature — one message signed by two signers recovers each signer`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P8
- `evicts the oldest entry first at SIGNER_RECOVERY_CACHE_MAX and recomputes it correctly`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P4
- `every contract-rejected encoding throws before the memo and leaves it unchanged`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P6
- `accepts exactly the encodings the contracts accept, recovering the same signer`: UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P5, INV-MIRROR-1-VAF778.T1.P7
- `recovering the same signature twice reports nothing`: REQ-ID-5-GW1ZEY.T1.P1, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P5
- `a second nonce signature by one signer on one message reports that signer`: REQ-ID-5-GW1ZEY.T1.P2, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P6
- `a v 0/1 re-encoding of a recovered signature reports nothing`: REQ-ID-5-GW1ZEY.T1.P3, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P7
- `a v 35/36 re-encoding of a recovered signature reports nothing`: REQ-ID-5-GW1ZEY.T1.P4, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P8
- `a 64-byte compact re-encoding of a recovered signature reports nothing`: REQ-ID-5-GW1ZEY.T1.P5, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P9
- `the 65-byte signature after its compact re-encoding reports nothing`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P10
- `one signer's signatures on different messages report nothing`: REQ-ID-5-GW1ZEY.T1.P6, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P11
- `two signers' signatures on one message report nothing`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P12
- `the canonical-signature memo is bounded by SIGNER_RECOVERY_CACHE_MAX`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P13
- `a conflict with an evicted signer entry goes unreported while a retained one is reported`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P14
- `every registered listener hears a report`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P15
- `a removed listener hears no later report`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P16
- `a throwing listener neither fails recovery nor starves another listener`: UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P17
- `a join signature re-signed with another nonce reports its signer`: REQ-ID-5-GW1ZEY.T1.P13, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P18
- `a transaction signature re-signed with another nonce reports its signer`: REQ-ID-5-GW1ZEY.T1.P14, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P19
- `a dispute signature re-signed with another nonce reports its signer`: REQ-ID-5-GW1ZEY.T1.P15, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P20
- `an open-channel signature re-signed with another nonce reports its signer`: REQ-ID-5-GW1ZEY.T1.P16, UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P21
- `the SDK signing path signs one message to identical bytes twice`: REQ-ID-5-GW1ZEY.T1.P17
