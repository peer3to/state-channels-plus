# Chain Access Through Several RPC Endpoints

> **Agent status:** Maintained draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A participant reads the base chain, sends its transactions, and observes the manager's events through
one or more RPC endpoints of one chain. The endpoints form an ordered list. A single endpoint is the
list of one. Losing the connection to one endpoint must not silence chain observation or stop chain
access while another listed endpoint is reachable, and an endpoint that comes back must not leave a
gap in the observed events.

## Requirements and invariants

**<a id="req-chainobs-1-5jthy8"></a>`REQ-CHAINOBS-1-5JTHY8` — Ordered endpoint set.** The configuration MUST name the endpoints
in priority order. When the list is absent or empty, the single configured endpoint is the whole
list. Every entry MUST be a WebSocket-compatible endpoint; an entry that is not rejects startup.
Startup MUST succeed when at least one listed endpoint is reachable; the others keep reconnecting.
When none is reachable, startup MUST fail, naming every endpoint, and release every connection it
opened.

**<a id="req-chainobs-2-2ncsq3"></a>`REQ-CHAINOBS-2-2NCSQ3` — One endpoint per request, with failover.** Every chain request,
read or transaction, MUST go to the first listed endpoint that is connected. It moves to the next
connected endpoint only when that endpoint has no connection or loses it before answering; a request
in flight on a dropped endpoint MUST be answered by the next connected endpoint, not wait for the
dropped one. A transaction MUST NOT be sent to several endpoints at once. An endpoint's own answer,
including a rejection, is final for that request. While no endpoint is connected, a request waits for
the first endpoint to reconnect.

**<a id="req-chainobs-3-n137zp"></a>`REQ-CHAINOBS-3-N137ZP` — Per-endpoint observation with reconnect and catch-up.** The
participant MUST subscribe to the channel's manager events on every connected endpoint. A dropped
endpoint MUST be reconnected with a bounded backoff, independently of the other endpoints, and its
subscription renewed. After a reconnect, the participant MUST re-read the channel's events on that
endpoint from its completed-block progress marker, inclusive, up to that endpoint's head, so that an
event emitted while the endpoint was down is processed. Before any event completed a block, the
re-read starts at the block where the subscription began.

**<a id="inv-chainobs-1-asvkc1"></a>`INV-CHAINOBS-1-ASVKC1` — Exactly-once event processing across endpoints.** One chain event
delivered by several endpoints, or by a stream and a re-read, MUST be processed once. Event identity
includes the containing block, so an event re-mined in another block after a reorganization is a new
event. An event the chain reports as removed by a reorganization is logged and ignored; its earlier
effects are not undone. An event an endpoint's stream or re-read delivers below the completed-block
progress marker is dropped: its block is fully processed.

## Assumptions and constraints

- Every listed endpoint serves the same chain; the participant does not merge different chains.
- At least one listed endpoint is honest and eventually reachable
  ([../security/trust-model.md](../security/trust-model.md)).
- An endpoint delivers a block's events in order on one connection.
- A connection that drops in the middle of one block's events can leave part of that block unread until
  a later recovery query; the inclusive re-read covers the progress-marker block itself.
- Undoing the effects of a removed event is out of scope.
- Recovery queries that deliberately read below the progress marker are not stream deliveries and are
  not subject to the below-marker drop.

## Security considerations

Assets: the completeness and uniqueness of observed manager events, which every dispute, exit, and
membership decision relies on, and the participant's transaction nonces. A dropped or censoring
endpoint can hide events; listing several endpoints and re-reading after reconnect bounds that to the
time all endpoints are unreachable. A lagging endpoint can redeliver old events; block-scoped identity
and the progress-marker drop prevent double processing. Sending one transaction to one endpoint at a
time avoids leaking it to every endpoint and keeps nonce reconciliation with one source. Endpoint URLs
can carry credentials, so logs name an endpoint only by scheme and host. Residual risks: a reorganization's
removed events stay applied, and a mid-block drop can delay part of a block until recovery.

## Verification and test plan

### Requirement test matrix

| Plan item                                                       | Requirements / invariants                                             | Setup and stimulus                                                                                                              | Expected result                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="req-chainobs-1-5jthy8.t1"></a>`REQ-CHAINOBS-1-5JTHY8.T1` | [`REQ-CHAINOBS-1-5JTHY8`](chain-observation.md#req-chainobs-1-5jthy8) | Resolve and start with absent, empty, ordered and invalid endpoint lists, and with some or no endpoint reachable.               | Resolution keeps list order; invalid entries and no reachable endpoint reject startup; one reachable endpoint starts.   | <a id="req-chainobs-1-5jthy8.t1.p1"></a>`REQ-CHAINOBS-1-5JTHY8.T1.P1` — absent list; <a id="req-chainobs-1-5jthy8.t1.p2"></a>`REQ-CHAINOBS-1-5JTHY8.T1.P2` — empty list; <a id="req-chainobs-1-5jthy8.t1.p3"></a>`REQ-CHAINOBS-1-5JTHY8.T1.P3` — ordered list replaces the single endpoint; <a id="req-chainobs-1-5jthy8.t1.p4"></a>`REQ-CHAINOBS-1-5JTHY8.T1.P4` — invalid entry; <a id="req-chainobs-1-5jthy8.t1.p5"></a>`REQ-CHAINOBS-1-5JTHY8.T1.P5` — one of two reachable; <a id="req-chainobs-1-5jthy8.t1.p6"></a>`REQ-CHAINOBS-1-5JTHY8.T1.P6` — none reachable.                                                                                                                                                                                                                   |
| <a id="req-chainobs-2-2ncsq3.t1"></a>`REQ-CHAINOBS-2-2NCSQ3.T1` | [`REQ-CHAINOBS-2-2NCSQ3`](chain-observation.md#req-chainobs-2-2ncsq3) | Send reads and transactions with every endpoint up, the first one down, the first one dropping mid-request, and no endpoint up. | Requests reach exactly the first connected endpoint; a drop moves them on; none is lost or duplicated across endpoints. | <a id="req-chainobs-2-2ncsq3.t1.p1"></a>`REQ-CHAINOBS-2-2NCSQ3.T1.P1` — transaction with all endpoints up; <a id="req-chainobs-2-2ncsq3.t1.p2"></a>`REQ-CHAINOBS-2-2NCSQ3.T1.P2` — transaction with the first endpoint down; <a id="req-chainobs-2-2ncsq3.t1.p3"></a>`REQ-CHAINOBS-2-2NCSQ3.T1.P3` — read with the first endpoint down; <a id="req-chainobs-2-2ncsq3.t1.p4"></a>`REQ-CHAINOBS-2-2NCSQ3.T1.P4` — read in flight when the first endpoint drops; <a id="req-chainobs-2-2ncsq3.t1.p5"></a>`REQ-CHAINOBS-2-2NCSQ3.T1.P5` — no endpoint connected, then one reconnects; <a id="req-chainobs-2-2ncsq3.t1.p6"></a>`REQ-CHAINOBS-2-2NCSQ3.T1.P6` — a participant's protocol reads and own transaction with its first endpoint down.                                                 |
| <a id="req-chainobs-3-n137zp.t1"></a>`REQ-CHAINOBS-3-N137ZP.T1` | [`REQ-CHAINOBS-3-N137ZP`](chain-observation.md#req-chainobs-3-n137zp) | Drop endpoints, emit events while they are down, and restore them.                                                              | Reconnect follows the bounded backoff; events emitted during the outage are processed after the reconnect.              | <a id="req-chainobs-3-n137zp.t1.p1"></a>`REQ-CHAINOBS-3-N137ZP.T1.P1` — backoff bound; <a id="req-chainobs-3-n137zp.t1.p2"></a>`REQ-CHAINOBS-3-N137ZP.T1.P2` — reconnected socket renewed for subscriptions; <a id="req-chainobs-3-n137zp.t1.p3"></a>`REQ-CHAINOBS-3-N137ZP.T1.P3` — endpoint refusing its first connection keeps retrying; <a id="req-chainobs-3-n137zp.t1.p4"></a>`REQ-CHAINOBS-3-N137ZP.T1.P4` — re-read delivers an event the stream lost; <a id="req-chainobs-3-n137zp.t1.p5"></a>`REQ-CHAINOBS-3-N137ZP.T1.P5` — event emitted while the only endpoint was down is processed after it returns.                                                                                                                                                                       |
| <a id="inv-chainobs-1-asvkc1.t1"></a>`INV-CHAINOBS-1-ASVKC1.T1` | [`INV-CHAINOBS-1-ASVKC1`](chain-observation.md#inv-chainobs-1-asvkc1) | Deliver the same event again from another stream, a re-read, another block, as removed, and below the progress marker.          | Each event is processed exactly once; re-mined events count as new; removed and below-marker deliveries are dropped.    | <a id="inv-chainobs-1-asvkc1.t1.p1"></a>`INV-CHAINOBS-1-ASVKC1.T1.P1` — duplicate from a second stream; <a id="inv-chainobs-1-asvkc1.t1.p2"></a>`INV-CHAINOBS-1-ASVKC1.T1.P2` — re-mined in another block; <a id="inv-chainobs-1-asvkc1.t1.p3"></a>`INV-CHAINOBS-1-ASVKC1.T1.P3` — removed by a reorganization; <a id="inv-chainobs-1-asvkc1.t1.p4"></a>`INV-CHAINOBS-1-ASVKC1.T1.P4` — re-read of events already processed; <a id="inv-chainobs-1-asvkc1.t1.p5"></a>`INV-CHAINOBS-1-ASVKC1.T1.P5` — re-read of the channel's opening events; <a id="inv-chainobs-1-asvkc1.t1.p6"></a>`INV-CHAINOBS-1-ASVKC1.T1.P6` — lagging delivery below the progress marker; <a id="inv-chainobs-1-asvkc1.t1.p7"></a>`INV-CHAINOBS-1-ASVKC1.T1.P7` — every event once with two endpoints and one cut. |

## Future Work

_Non-normative._ Cross-check that a late-connecting endpoint serves the same chain as the others, and
mark endpoints that answer with errors as unhealthy.
