# LobbyMatchingService.test.ts

Test file: [test/rpc/lobbyMatching/LobbyMatchingService.test.ts](../../../../../../../test/rpc/lobbyMatching/LobbyMatchingService.test.ts)
Exercises: [LobbyMatchingService.ts](../../../../../implementation/source/src/rpc/network/services/lobbyMatching/LobbyMatchingService.ts.md)

## Overview

Drive real service input gates and a configured counting or throwing policy; inspect callback counts, error identity, return status and unchanged channel/status.

The default main RPC root is driven through a worker-hosted P2P manager with concrete authenticated profiles. It proves canonical bootstrap, atomic reservation, correlated outcomes, monotonic retry epochs, one exhaustion switch, post-commit rejection without blacklist, accepted-lease profile-loss liability, bounded abuse, role timing, and cleanup that leaves the topic before it closes the session transports.

## Tests

- `bootstraps an advertiser, reserves one picker, and resolves only after valid commitment`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P1, REQ-LOBBY-2-TSWRV6.T1.P2, REQ-LOBBY-2-TSWRV6.T1.P3, REQ-LOBBY-2-TSWRV6.T1.P6, REQ-LOBBY-3-Q9WY40.T1.P1, REQ-LOBBY-4-E0TARV.T1.P1, REQ-LOBBY-4-E0TARV.T1.P2, REQ-LOBBY-5-VTRX8C.T1.P2, REQ-LOBBY-5-VTRX8C.T1.P3, REQ-LOBBY-5-VTRX8C.T1.P4, INV-LOBBY-1-TW7RZT.T1.P2, INV-LOBBY-1-TW7RZT.T1.P4
- `keeps a reservation through final profile loss, strikes at its bound, and bounds rejected lobby traffic`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P2, UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P11, REQ-LOBBY-9-N894C0.T1.P2
- `assigns opposite bootstrap roles and rejects invalid lobby candidates`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P3, REQ-LOBBY-2-TSWRV6.T1.P1, REQ-LOBBY-3-Q9WY40.T1.P2
- `uses bounded role jitter and defers a role transition while reserved`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P4, REQ-LOBBY-3-Q9WY40.T1.P4, REQ-LOBBY-5-VTRX8C.T1.P1, REQ-LOBBY-6-QSZEXP.T1.P2, REQ-LOBBY-6-QSZEXP.T1.P3, REQ-LOBBY-6-QSZEXP.T1.P5
- `settles replacement, leave, timeout, and disposal through one cleanup path`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P5, REQ-LOBBY-9-N894C0.T1.P3, REQ-LOBBY-9-N894C0.T1.P5, REQ-LOBBY-9-N894C0.T1.P6, REQ-LOBBY-9-N894C0.T1.P9, REQ-LOBBY-9-N894C0.T1.P11
- `keeps the local role epoch monotonic across same-topic retries`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P6, REQ-LOBBY-3-Q9WY40.T1.P3
- `schedules only one advertiser switch while candidates stay exhausted`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P7, REQ-LOBBY-3-Q9WY40.T1.P5, REQ-LOBBY-6-QSZEXP.T1.P4
- `leaves the lobby topic before closing a non-selected transport`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P13, REQ-LOBBY-9-N894C0.T1.P20
- `leaves the lobby topic before a cancelled session closes its transports`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P16, REQ-LOBBY-9-N894C0.T1.P23
- `keeps the selected transport through the handoff`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P14, REQ-LOBBY-9-N894C0.T1.P21
- `rejects a late pick after commitment without blacklisting its requester`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P8, REQ-LOBBY-9-N894C0.T1.P7
- `completeLobby preserves the handed-off transport after targeted completion`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P9

### Generic matcher additions

Direct cases prove caller-topic matching without negotiation ownership, allow-all default policy, unmatched
timeout cleanup, timer removal before accepted-match resolution, one shared unmatched cancellation owner,
post-handoff cancellation no-op, selected-transport preservation, and targeted release without automatic
re-entry. These cover `REQ-TJOIN-3-DCZKS6`.

The reservation-recovery declaration also separates neutral loss from abuse: final profile loss
does not blacklist, while repeated authenticated wrong-topic traffic reaches the bounded rejection
limit, then blacklists and disconnects that peer.

### Targeted matcher declarations

- `settles cancellation when the selected peer disconnects during commit`: UNIT-TEST-LOBBY-CANCELLATION-1-FDXZHE.P1, REQ-LOBBY-7-BXQ1QA.T1.P7, UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P10

- `returns a committed match without starting negotiation`: none
- `unmatched finite timeout cleans only matcher-owned resources`: none
- `accepted match cancels timeout before resolving`: none
- `accepted match disarms finite timeout before negotiation`: none
- `accepted match has no matchmaking timeout during negotiation`: none
- `finite matchmaking timeout returns false while unmatched`: none
- `default lobby matching allows an authenticated peer without a filter`: none
- `ordinary and targeted callers share one unmatched cancellation owner`: none
- `matcher cancellation is a no-op after handoff`: none
- `pre-open targeted lobby frames do not reach peers on the raw channel key`: REQ-TJOIN-2-MFWADG.T1.P1
- `pre-open routing probe settles after the raw-topic peer receives no frame`: none
- `observed-open loser releases matching ownership for the selected channel`: none
- `does not call the configured filter for its own address`: UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P1
- `does not call the configured filter for an unknown transport`: UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P2
- `propagates the configured filter error unchanged for a foreign peer`: UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P3
- `checks malformed availability and missing reservations before the configured filter`: UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P4
- `rejects zero lobby balance before changing the selected channel or status`: UNIT-TEST-LOBBY-MATCHING-SERVICE-32-R6FA7Z.P5
- `bootstraps roles again when the same peers meet in a later session`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P19
- `starts a new session only after the cancelled session's held cleanup finished`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P17
- `completes the handoff when the discovery leave fails`: UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P18, REQ-LOBBY-9-N894C0.T1.P22
