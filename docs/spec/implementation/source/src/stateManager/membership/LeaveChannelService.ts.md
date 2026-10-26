# LeaveChannelService.ts

> **Source:** [LeaveChannelService.ts](../../../../../../../src/stateManager/membership/LeaveChannelService.ts)

## Requirements

- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-DISPUTE-PIPE-7-76N72X` (Combined membership intent)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)

## UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9

Terminal leave state machine

- Setup: Enter through `P2pInstance.leaveChannel` or the internal signer route from every commitment state, or through the signer's own exit block with no leave call; block, fail or hold the exit's snapshot posts.
- Oracle: Hook substitution, the one watchdog bound, self-removal dispute input, one exit post per finalized block with at most one in flight and one follow-up post per queued trigger (an exit block posts again), one post in flight of an installed reduction that leaves no participant (threshold-final, or once its reduced result is committed; a post queued while one runs is replayed through the membership check), an expected refusal of that post when another post closed the channel first, one `onLeftChannel` per drop to `SYNCED`, one terminal disposal and fatal errors for a stopped leave are exact; no cross-channel work starts.

- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P1` — immediate non-committed leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P2` — authored exit
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P3` — pending promotion
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P4` — more than N + 1 blocks before the leaver's exit start no fallback
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P5` — zero-block watchdog
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P6` — existing dispute wait and next-fork retry
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P8` — pending leave with the signer still local makes no chain membership read
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P9` — pending terminal leave rejects joinLobby
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P10` — pending terminal leave rejects joinChannel
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P11` — pending terminal leave rejects topUpBalance
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P12` — pending terminal leave rejects collectJoinChannelConfirmation
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P14` — a leave watchdog dispute that loses the evidence race keeps the leave waiting with no error
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P15` — disposal during a held watchdog upload stops the runtime at once; the late completion reports nothing
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P16` — an authored exit whose snapshot posts all fail falls back at the leave watchdog; a dispute submission that fails with no recognized chain refusal is a fatal runtime error and leaves no dispute marker
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P17` — an authored exit whose snapshot posts all fail falls back at the leave watchdog; an evidence-expired refusal waits for the window's reduction, and the reduced fork that drops the leaver emits `onLeftChannel`
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P23` — Both founders get `onLeftChannel` after the last exit closes the channel and status becomes NOT_OPENED
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P24` — Leaving an unobserved join waits for authorization expiry, then settles SYNCED with `onLeftChannel` and no dispute
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P25` — JOIN observation while leave waits changes it to member exit handling; explicit disposal stops the unfinished member leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P26` — Both founders leave through the public runtime API, both get `onLeftChannel`, the channel disappears from the open-channel registry and on-chain participants become empty
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P27` — With an unconsumed on-chain JOIN blocking exit snapshot updates, both founders submit self-removal disputes on the original fork without changing the chain snapshot first; each gets `onLeftChannel` and reduction seats the sole joiner
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P28` — After an uncertain join submission preserves local pending status but never lands, leave waits for authorization expiry and resolves SYNCED with the address absent from both on-chain participant sets
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P29` — a leave that settles while its exit's posts are blocked ends the exit: the leave watchdog starts no self-removal dispute and no further post runs
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P30` — disposal stops the exit's snapshot posts together with the leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P31` — the one leave watchdog stays armed from the leave call through the authored exit and is cancelled when the exit settles
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P32` — the finalized exit block makes the leaver post the latest state snapshot, and that post settles the leave with no dispute
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P33` — a post blocked by an unconsumed inbound join lands nothing; the post of a later finalized block that consumes the join lands the exit, with no dispute
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P34` — when no block consumes the blocking join, each finalized block posts again and lands nothing, and the leave watchdog starts one self-removal dispute
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P35` — at most one exit post is in flight: blocks finalized while a refused post runs queue exactly one more post after it, and the next finalized block posts again
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P36` — an exit block the application authors with no leave call sets self-removal and is posted the same way; the runtime ends `SYNCED` with self-removal still set and no dispute
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P37` — after an exit block with no leave call, a dispute observed on the fork carries the leaver's self-removal at once; the reduced snapshot drops it and self-removal stays set
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P38` — a join in progress at the leave watchdog's expiry re-arms the watchdog and starts no dispute
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P39` — a new fork that still holds the signer restarts the exit there as a requested leave; the force-exit flag stays set
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P40` — a finally refused first join emits `onLeftChannel` once; a race or authorization refusal emits it before `onAbort`
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P41` — a submitted join that expires before it lands emits `onLeftChannel` once with no leave call

- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P42` — an expected exit-post chain refusal reaches the internal logger and normal later posting remains enabled
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P43` — an unexpected exit-post error reaches fatal runtime handling instead of being swallowed
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P44` — a block finalized while a post runs queues no further post when that post returns a snapshot that drops the signer: one send, no second post
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P45` — a lone leaver whose installed self-removal reduction has no participant while the chain still lists it starts exactly one post of that reduced fork; the post closes the channel and the leave settles
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P46` — a leaver whose installed self-removal reduction keeps other participants starts no post while the chain still lists it; the remaining participants' adoption settles the leave
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P47` — a leaver's exit post of a non-final reduction that leaves no participant, prepared and held at its send while the reducer's adoption post closes the channel, is refused with `RaceConditionGenesisTimestampNotAvailable`: the refusal is logged once, no runtime error is raised and the leaver gets `onLeftChannel` once
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P48` — a post queued during an in-flight zero-participant post is replayed through the membership check and closes the channel: a leaver whose install-time post of a non-final reduction finds no reduced result posts that fork again once the post ends when the reduced result is committed during it, and that post closes the channel while the reducer's adoption and its retry fail
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P49` — a queued exit post is replayed once: an exit-block leaver whose exit leaves no participant makes one follow-up post per queued trigger while its posts are refused, never back-to-back posts
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P50` — a leave watchdog that expires after the leaver submitted its self-removal dispute for an observed dispute, while that fork is still disputed, starts no second dispute; the reduced snapshot that drops the leaver emits `onLeftChannel` once
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P51` — an exit snapshot that lands on chain before the leaver's self-removal dispute is sent: the chain refuses the upload with `ErrorCantParticipateInDispute`, the refusal raises no runtime error, and the leaver drops to `SYNCED` with one `onLeftChannel` and no `onAbort`
- [x] `UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P52` — a leave watchdog that expires after the exit snapshot moved the leaver's local anchor past its latest block, while its membership check still reads the chain, runs that check first: the check settles the leave and no self-removal dispute starts
