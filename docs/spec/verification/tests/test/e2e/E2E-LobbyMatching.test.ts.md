# E2E-LobbyMatching.test.ts

Test file: [test/e2e/E2E-LobbyMatching.test.ts](../../../../../../test/e2e/E2E-LobbyMatching.test.ts)
Exercises: [LobbyMatchingService.ts](../../../../implementation/source/src/rpc/network/services/lobbyMatching/LobbyMatchingService.ts.md), [OpenChannelNegotiationService.ts](../../../../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md), [LocalDiscoveryServer.ts](../../../../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md)

## Overview

These default-threaded E2E cases use real authenticated transports, the default main RPC root,
negotiated transcripts, and the deployed manager. They cover normal matching, opening, a synchronized
post-open transition after discovery leave, topic
isolation, many-peer convergence without honest-peer blacklists, timeout punishment, accepted-lease
profile loss punished on both sides in either bound order, final-profile
loss, transport upgrades during selection and commitment handoff, invalid raw traffic, stale channel
events, deferred negotiation handoff, and LocalDiscovery replacement while a committed lobby topic remains
observed. The replacement cases count real authentication calls before and after handoff. Both terminal
owners stop replacement by leaving the topic.

The normal matching case counts on-chain transactions: the higher participant sends exactly one opening
transaction and the lower sends none. The exact submitted payload and both signatures are asserted by the
`OpenChannelNegotiationService` suite.

The pending-selection upgrade case holds the pick reply and its matching RPC-expiry task until the real WebRTC upgrade completes. It asserts one captured expiry task, pending selection and no blacklist, then releases the reply and observes channel opening. The bound-order cases exercise timeout liability separately.

The disconnect-during-selection case holds the completion of the higher peer's channel selection (its event listener's subscription removal) after the lower peer's terms validated, then isolates the lower peer, so the unsigned attempt is cleared while the selection is still pending. A third peer joins the same topic; once both sides of the new pair selected the new ID and one `openProposal` reply is parked, the stale selection is released. The oracle is that the new pair opens exactly the negotiated channel, both peers reach `PARTICIPATING` on it, the dead ID never opens, and neither new partner blacklists the other. Without the selection guards the released selection re-subscribes the higher peer's listener to the dead channel, the higher peer never observes its own opening, and the case times out waiting for `PARTICIPATING`.

The signed-attempt remote-abort case waits for both peers to observe transport closure before checking their respective zero/one strike outcomes. Run 453 queried the lower peer before its socket-close event arrived. The signature retention and eventual chain-opening assertions remain unchanged; runtime revalidation is pending.

The expired-opening case shortens the lower proposer's opening window to six seconds with a host stub
that offsets only the clock read that derives the deadline. Six seconds is below the higher peer's
30-second minimum, so a second stub offsets only the higher peer's clock read that sets its deadline
bounds, lowering that minimum to one second for this one proposal; a real deadline over 30 seconds plus
setup, matching, and the expiry observation would not fit the global test timeout. The case parks the
higher peer's real submission after it co-signed. It waits until the higher peer's own expiry observation ends the signed attempt,
then polls the latest block until its timestamp is past the deadline, and only then releases the
retained signatures to the real submission. The wait sends no transactions and calls no time RPC: it
relies on the interval-mined E2E node to advance chain time, so on an automine node it times out. A
record-only wrapper reads the reverted transaction's error back from its trace. The oracle is exactly
one recorded rejection, `RaceConditionOpenChannelExpired`, and the negotiated channel still closed on
chain. Without the contract check the same release opens the channel and the case fails.

The late-mined-opening case uses the same two deadline stubs and the submission hold. It also holds
both peers' opening-expiry observation tasks, so the signed attempts stay current. After the latest
block is past the deadline, it asserts the higher peer's attempt is unchanged and only then releases
the submission, so the higher peer's own `open` is mined late on a live attempt. The oracle is exactly
one recorded rejection, `RaceConditionOpenChannelExpired`; the higher peer's attempt then ends, the
negotiated channel stays closed, and the higher peer records no strike and no blacklist against the
lower peer. The case then drops the higher peer's held expiry task, runs the lower peer's held task to
end its signed attempt, and requires both peers to open one fresh channel with a different ID on the
same topic. It settles the reverted receipt as the expected detached error. When the receipt-failure
close spends a strike instead, the case fails on the strike count.

The too-close-deadline case shortens the lower proposer's opening window to ten seconds, below the
higher peer's 30-second minimum, without lowering that minimum, and installs the submission hold on the
higher peer so that any submission would be parked and counted. It waits until the higher peer
blacklists the lower peer, then asserts that the proposer's stub derived the short deadline, that the
higher peer parked no submission, and that no opening rejection was recorded: the proposer is excluded
before the higher peer signs or submits anything. It then waits until the lower peer's own signed attempt ends at its
deadline before leaving the lobby.

## Tests

- `matches two authenticated peers, derives one ID, and opens one channel`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P1, REQ-LOBBY-1-PZTPKD.T1.P1, REQ-LOBBY-9-N894C0.T1.P8, REQ-NEG-1-RTKPT1.T1.P7
- `keeps two caller-supplied lobby topics isolated`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P2, REQ-LOBBY-1-PZTPKD.T1.P2
- `converges four peers on one topic into two exclusive pairs`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P3, INV-LOBBY-1-TW7RZT.T1.P1, INV-LOBBY-1-TW7RZT.T1.P3, REQ-LOBBY-4-E0TARV.T1.P3
- `suspends a repeatedly silent picker at the retry bound and pairs with another peer on the same topic`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P4, REQ-LOBBY-7-BXQ1QA.T1.P1, REQ-LOBBY-7-BXQ1QA.T1.P3, REQ-LOBBY-7-BXQ1QA.T1.P8
- `treats final profile loss during selection as neutral and retries immediately`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P5, REQ-LOBBY-8-31BE0F.T1.P5
- `strikes both sides after commitment silence and lets the same pair rematch`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P6, REQ-LOBBY-7-BXQ1QA.T1.P2, REQ-LOBBY-7-BXQ1QA.T1.P4
- `excludes both sides when the advertiser bound fires before the selector bound`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P13, REQ-LOBBY-7-BXQ1QA.T1.P5
- `excludes both sides when the selector bound fires before the advertiser bound`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P14, REQ-LOBBY-7-BXQ1QA.T1.P6
- `keeps a pending selection intact through a successful transport upgrade`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P9, REQ-LOBBY-6-QSZEXP.T1.P1, REQ-LOBBY-8-31BE0F.T1.P3
- `keeps the committed pair intact when transport upgrade completes during negotiation handoff`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P10, REQ-LOBBY-8-31BE0F.T1.P6
- `keeps a reservation unchanged under stale, duplicate, malformed, and wrong-peer RPCs`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P7, REQ-LOBBY-4-E0TARV.T1.P4, REQ-LOBBY-9-N894C0.T1.P1, REQ-LOBBY-2-TSWRV6.T1.P5
- `queues early negotiation while matched initialization and ID selection are held`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P8
- `rematches and opens one channel after the counterparty disconnects while the higher peer is still selecting the channel`: none
- `leaves the lobby topic at handoff so the matched pair stops redialing non-selected peers during negotiation`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P11, REQ-LOBBY-9-N894C0.T1.P14
- `leaves the targeted lobby topic at handoff so the matched pair stops redialing non-selected peers during negotiation`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P12, REQ-LOBBY-9-N894C0.T1.P15
- `treats a remote negotiation abort as a lobby exit, not a fault`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P15, REQ-NEG-4-ZQ0985.T1.P12
- `ends a lobby join left during the negotiation handoff instead of rematching`: REQ-LOBBY-9-N894C0.T1.P26

The ordinary regression keeps transcript-derived negotiation distinct from targeted fixed-ID work. Matching
returns a generic committed peer; `joinLobby` starts negotiation and consumes its direct outcome. An
already-open derived ID is a protocol failure with punishment, listener cleanup, and no raw-topic sync path.

- `keeps a signed attempt observing the chain after a remote abort and opens on the observed submission`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P16
- `rejects retained opening signatures submitted on chain after the SDK expired the opening terms`: REQ-ENFADM-4-2NN96F.T1.P4
- `closes the peer without a strike and rematches when a live attempt's own opening is mined after the deadline`: REQ-NEG-4-ZQ0985.T1.P19
- `excludes a proposer whose opening deadline leaves less than the minimum window, without submitting`: INV-NEG-1-6FW90P.T1.P11
- `retries a targeted connect on the same runtime after a remote abort`: INTEGRATION-TEST-LOBBY-MATCHING-1-6WE54B.P17
