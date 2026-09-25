# SignatureUtils.ts

> **Source:** [src/utils/SignatureUtils.ts](../../../../../../src/utils/SignatureUtils.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9)
  Missing: No object-type, chain or deployment domain tags in the signed data. See [`OQ-29-EFY4NF` (Signature domain separation)](../../../../specification/open-questions.md#oq-29-efy4nf).
- [`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)
- [`INV-ID-1-B4FXJ4` (Key control is identity)](../../../../specification/protocol-model/identity.md#inv-id-1-b4fxj4)
- [`REQ-DATA-3-ANVN8X` (Encoded and signed values bind every domain coordinate required by their owning…)](../../../../specification/protocol-model/data-types.md#req-data-3-anvn8x)

## UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58

Sign/recover

- Setup: Sign each object class; recover; tamper; malleate
- Oracle: Recovery matches signer; tampering breaks; malleation never yields a second identity

- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P1` — block round trip
- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P2` — tamper detection
- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P3` — malleation behavior
- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P4` — join-channel round trip
- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P5` — open-channel round trip
- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P6` — transaction round trip
- [ ] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P7` — dispute round trip
- [x] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P8` — normalizes equivalent hex and bytes without changing recovery
- [x] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P9` — does not repair malformed hex or reinterpret a recovery byte
- [x] `UNIT-TEST-SIGNATURE-UTILS-1-9ZHM58.P10` — keeps compact signature bytes compact
