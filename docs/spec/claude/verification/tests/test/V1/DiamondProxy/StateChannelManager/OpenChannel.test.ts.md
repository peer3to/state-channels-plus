# test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts — Test Report

> **Test file:** [test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/OpenChannel.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                         | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants - success` (line 63)                                        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants signatures not inorder - success` (line 89)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants 1 signature - fail` (line 115)                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants double signature - fail` (line 130)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants wrong encoded openChannel msg - fail` (line 144)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants no signatures - fail` (line 163)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants invalid signature length - fail` (line 173)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > forces inbound join message and updates math state machine` (line 208)     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > requires the encoded participant to submit the join` (line 331)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > tops up an existing participant without duplicating membership` (line 359) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants channelId = 0 - fail` (line 430)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants channel already exists - fail` (line 466)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants channelId cannot be 0x0 - fail` (line 506)                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants amount 0 - success with zero balance` (line 541)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy > Open Channel - MathStateChannel > 2 participants time expired - fail` (line 581)                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
