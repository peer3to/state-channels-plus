# BotConnectionFixes.test.ts

Test file: [test/unit/BotConnectionFixes.test.ts](../../../../../../test/unit/BotConnectionFixes.test.ts)

## Overview

Exercises channel discovery, terminal leave, authoritative initial-sync eligibility and force-join timing through runtime APIs and real channel state.

The own-join cases carry the IDs `U75a`…`U75f`. `U75f` makes a prepared first join's submission
uncertain (its authorization stays open for 120 seconds), then a founder posts a snapshot that lists no
pending join; after the joiner handled that snapshot event its status is still `PENDING_PARTICIPANT` and
its own join state is still open.

## Tests

- `U70: a lobby open makes both founders join the opened channel's discovery key as participants`: REQ-TJOIN-2-MFWADG.T2.P1, UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P6
- `U71: both founders leave and the last exit closes the channel → both terminal leaves settle on NOT_OPENED`: REQ-LIF-10-QR8NQ9.T2.P1, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P23
- `U72: a same-fork snapshot post waiting on an inbound message its snapshot has not consumed resolves false and posts nothing`: REQ-ENFSNAP-3-VD9T8A.T2.P1, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P10
- `U72: a leaver whose exit snapshot post is blocked by an unconsumed inbound join gets false and starts its self-removal dispute`: REQ-ENFSNAP-3-VD9T8A.T2.P2, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P11
- `U73: a latest-state request to a responder whose own state is not installed → refused for the chain-derived fork, requester not blacklisted`: REQ-SYNC-1-T2589H.T2.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P42
- `U73: a latest-state request to a responder whose own fork is behind the chain-derived fork → served from the derived fork, neither side blacklisted`: REQ-SYNC-1-T2589H.T2.P2, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P43
- `RO2: seating a join during its deadline membership read prevents a stale dispute request`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P46, UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P7
- `RO2: the block bound wins while the deadline awaits membership and only one dispute is requested`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P47
- `RO2: reduction seats the pending join on a successor fork while its old deadline read is held`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P48
- `AO4: a force-join deadline reads a real expired evidence window and retains the pending join without submitting`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P49, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P9, INV-TJOIN-2-H7JSQM.T1.P7, INV-TJOIN-2-H7JSQM.T2.P10, UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P5
- `U74: observing its own join arms the force-join deadline at once, one full turn window per pending turn, while the counting grace still runs`: INV-TJOIN-2-H7JSQM.T2.P1, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P35
- `U74: a submitted join not yet observed on chain starts neither force-join bound while blocks arrive`: INV-TJOIN-2-H7JSQM.T2.P2, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P36
- `U74: the force-join deadline passing with no new block requests the force-join dispute`: INV-TJOIN-2-H7JSQM.T2.P3, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P37
- `U75a: a delayed on-chain observation starts the deadline and the counting grace at observation, not at submission`: INV-TJOIN-2-H7JSQM.T2.P4, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P38
- `U75b: an uncertain join that never reaches the chain → own join state open until the chain passes its authorization deadline, then expired`: INV-TJOIN-2-H7JSQM.T2.P5, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P39
- `U75c: a pending joiner whose join never lands → its leave waits for the join and settles back to SYNCED once the authorization expired on chain`: REQ-LIF-10-QR8NQ9.T2.P2, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P24
- `U75d: a join observed during the leave's join wait turns the leave into a member's leave`: REQ-LIF-10-QR8NQ9.T2.P3, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P25
- `U75e: a landed join whose self-removal reduction the joiner installs while the chain still lists it → the chain's snapshot event lowers it to SYNCED and its leave settles`: REQ-LIF-10-QR8NQ9.T2.P4
- `U75f: a pending joiner whose uncertain join can still land handles a snapshot event that does not list it → it stays PENDING_PARTICIPANT with its join open`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P18
- `U76: blocks committed during the agreementTime grace after the joiner observes its join are not counted; counting starts at the first block after it`: INV-TJOIN-2-H7JSQM.T2.P6, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P40
