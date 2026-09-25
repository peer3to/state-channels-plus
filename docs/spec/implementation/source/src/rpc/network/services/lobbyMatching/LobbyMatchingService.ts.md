# LobbyMatchingService.ts

> **Source:** [src/rpc/network/services/lobbyMatching/LobbyMatchingService.ts](../../../../../../../../../src/rpc/network/services/lobbyMatching/LobbyMatchingService.ts)

## Requirements

- [`INV-LOBBY-1-TW7RZT` (Exclusive match ownership)](../../../../../../../specification/peer-communication/lobby-matching.md#inv-lobby-1-tw7rzt)
- [`REQ-LOBBY-1-PZTPKD` (Caller-owned rendezvous)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-1-pztpkd)
- [`REQ-LOBBY-2-TSWRV6` (Authenticated admission)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-2-tswrv6)
- [`REQ-LOBBY-3-Q9WY40` (Convergent roles)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-3-q9wy40)
- [`REQ-LOBBY-4-E0TARV` (Atomic selection)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv)
- [`REQ-LOBBY-5-VTRX8C` (Mutual commitment)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-5-vtrx8c)
- [`REQ-LOBBY-6-QSZEXP` (Lease-safe role timing)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-6-qszexp)
- [`REQ-LOBBY-7-BXQ1QA` (Symmetric timeout consequence)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa)
- [`REQ-LOBBY-8-31BE0F` (Profile-loss recovery)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f)
- [`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)

## UNIT-TEST-LOBBY-CANCELLATION-1-FDXZHE

Stale commit cancellation

- Setup: Hold a selected commit, request cancellation, disconnect that peer, then reject commit.
- Oracle: Cancellation is true, matching has no result, resources clear, and the absent committed peer takes one counted close without being excluded.

- [x] `UNIT-TEST-LOBBY-CANCELLATION-1-FDXZHE.P1` — selected-peer disconnect during pending commit cancellation

## UNIT-TEST-LOBBY-MATCHING-1-SMZVNB

Exclusive lobby protocol

- Setup: Use the default RPC root with authenticated concrete profiles.
- Oracle: Canonical bootstrap, one reservation, explicit busy or rejection, no channel ID, session-local transport isolation, selected-only promotion, monotonic retry epochs, one exhaustion timer, neutral final loss, bounded inactive traffic, role timing, and complete cleanup.

- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P1` — advertiser bootstrap, accepted/busy pick results, rejected malformed commit, acknowledged valid commit, ID-free match, lobby transports absent from ordinary connections, selected-only promotion, non-selected close, and ordinary-broadcast isolation
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P2` — final profile loss of a reserved selector keeps the reservation until its bound, counts one close against the absent selector there, and repeated wrong-topic traffic closes the abusive transport
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P3` — both-none and one-none bootstrap, current epoch, topic, self, malformed, and reputation admission
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P4` — production and configured jitter, held-reservation transition, one counted close at expiry, and re-advertisement without timer reset
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P5` — replacement, matching leave, no implicit timeout, explicit timeout, and disposal settle once and close every session transport
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P6` — role epoch stays monotonic across same-topic retry and a peer holding the earlier epoch accepts the retried advertisement
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P7` — repeated empty-candidate advertisements retain one exhaustion switch
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P8` — a post-commit correlated pick returns rejected without blacklist
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P9` — targeted completion removes matcher ownership, preserves the selected handoff transport, and closes a non-selected matching-only transport
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P10` — a dropped commit records one strike on the absent peer and no verdict
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P11` — a reservation that expires records one strike on the silent selector and no verdict
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P13` — the handoff leaves the topic before it closes a non-selected transport
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P14` — the selected transport survives the handoff
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P16` — a cancelled session leaves the topic before its cleanup closes the session transports
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P17` — a session started while the previous cleanup still awaits its topic leave begins only after that cleanup finished, keeps its own transports and its caller-set status
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P18` — a discovery leave that rejects is reported and the handoff still completes with the selected transport kept and the non-selected closed
- [x] `UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P19` — peers that met in an earlier session bootstrap roles again in a later session on the same service

## INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B

Caller-topic matching and channel opening

- Setup: Run two or more real worker-hosted peers over local discovery and the default main root.
- Oracle: Same-topic peers form exclusive pairs without honest-peer blacklists, different topics remain isolated, each pair derives one ID, and timeout, loss, replacement discovery, upgrade, invalid traffic, and early handoff recover safely.

- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P1` — two-peer match, higher-address submission, open, automatic topic leave, and a synchronized post-open transition over the retained transport
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P2` — two-topic isolation
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P3` — four peers converge into two exclusive pairs without blacklisting honest peers
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P4` — a repeatedly silent picker costs one strike per window, is suspended at the bound, and another peer is selected on the same topic
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P5` — final profile loss releases immediately without blacklist and retries
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P6` — commitment silence costs one strike on each side, a late response is inert, and the same pair rematches and opens
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P7` — stale, duplicate, malformed, wrong-peer, and stale-channel traffic does not mutate a reservation or discovery
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P8` — early negotiation waits across matched initialization and channel-ID selection
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P9` — a pending selection survives a successful transport upgrade without blacklist
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P10` — a replacement authenticated after commitment joins the selected handoff and the pair opens without blacklist
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P11` — the ordinary handoff leaves the topic before it closes the non-selected transports, so local discovery never recreates one for the whole negotiation and `completeLobby` still preserves the selected handoff, with no promotion and no exclusion
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P12` — the targeted handoff leaves its derived topic the same way, so no non-selected peer is recreated before `releaseNegotiationHandoff`, with no promotion and no exclusion
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P15` — a peer that ends a live negotiation with the protocol's abort message keeps its identity standing and records no strike
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P13` — profile loss after an accepted lease with the advertiser bound firing first strikes both sides without a verdict
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P14` — profile loss after an accepted lease with the selector's commit rejection firing first strikes both sides without a verdict
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P16` — an abort against a locally signed attempt keeps the attempt observing the chain and the channel opens on the released submission
- [x] `INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P17` — a targeted connect that ends in a remote abort strikes no one and a second connect on the same runtime opens the channel

## UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z

Lobby validation and peer policy

- Setup: Drive real service input gates and a configured counting or throwing policy; inspect callback counts, error identity, return status and unchanged channel/status.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P1` — does not call the configured filter for its own address
- [x] `UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P2` — does not call the configured filter for an unknown transport
- [x] `UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P3` — propagates the configured filter error unchanged for a foreign peer
- [x] `UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P4` — checks malformed availability and missing reservations before the configured filter
- [x] `UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P5` — rejects zero lobby balance before changing the selected channel or status
