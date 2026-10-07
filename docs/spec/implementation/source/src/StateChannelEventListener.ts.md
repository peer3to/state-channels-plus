# StateChannelEventListener.ts — Source Report

> **Source:** [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../views/architecture/sdk/components.md), [runtime/chain-observation.md](../../views/runtime/chain-observation.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The manager-event subscription on every RPC endpoint: [setChannelId](../../../../../src/StateChannelEventListener.ts#L47) subscribes the
channel's filter on each node's open socket, and on every socket a node opens later, and forwards
each log into the event sync scheduler through scheduleStreamedLog. A socket that reopened is
subscribed first and then caught up from the completed-block watermark. Its live logs are held until
the catch-up has scheduled what it read, so a newer live log cannot complete first and move the
watermark past a missed block. When the socket is handed over, before the requests the reconnect
released can answer, it [holds the watermark](../../../../../src/StateChannelEventListener.ts#L92)
at the catch-up's first block until the read reaches the head or is abandoned, so a log a recovery
query completes in a later block cannot move it past unread blocks either. The catch-up is abandoned
when its socket ends: a [connection-loss watcher](../../../../../src/StateChannelEventListener.ts#L131)
hands on the held live logs and releases the hold at once, and the catch-up stops awaiting a read
that still waits for the node to reconnect, so it settles at once; the node's next socket starts its
own catch-up. It is also abandoned at once when the subscription is cleared or replaced, or the
listener is disposed: [removeListener](../../../../../src/StateChannelEventListener.ts#L271) runs
every running catch-up's [abort](../../../../../src/StateChannelEventListener.ts#L122), which drops
the removed subscription's held logs and releases the hold without waiting for a read or a retry's
backoff; the release runs once per hold. A
failed catch-up window is retried with the reconnect backoff while the socket stays open and the
subscription is current. The first read goes through the reopened node; after a failed read the
[remaining windows are read](../../../../../src/StateChannelEventListener.ts#L234) through the
runtime's provider, i.e. the first connected node, so one endpoint that keeps failing its reads
cannot hold the watermark. Those reads must still reach the reopened node's head, asked once on its
socket by [readSocketHead](../../../../../src/StateChannelEventListener.ts#L250) when the reader
switches: a first connected node behind it reads nothing and is asked again after the backoff
([`REQ-CHAINOBS-3-N137ZP` (Per-endpoint observation with reconnect and catch-up)](../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)).

## Key design decisions

Channel identity uses the shared permissive string/lowercase conversion; event matching and replacement checks retain their existing order. See [StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1).

1. **Thin by design** — ordering/recovery discipline lives in the sync service, not the listener.
2. **One end per catch-up** — the read finishing, the socket's loss, a cleared or replaced
   subscription and disposal all end the catch-up through the same
   [endCatchUp](../../../../../src/StateChannelEventListener.ts#L112), which flushes the held live
   logs before it releases the watermark, so they still pass the below-watermark check.
3. **Fallback reads through the first connected node** — chain logs are the same on every honest
   endpoint, so after the reopened node fails a window the catch-up reads the rest the way every
   other request is read. When that read fails too, it is retried with the reconnect backoff, still
   through the first connected node, until the reopened socket ends. The reopened node's head stays
   the read's target: it is read once on that node's open socket at the switch, which needs no
   reconnect wait and costs one request only on the failure path. When the node answers it with an
   error, the reads go up to the first connected node's own head.
4. **Removal aborts at once** — a cleared or replaced subscription aborts its running catch-ups
   instead of letting them notice the new generation after their read or backoff. Their held live
   logs belong to the removed subscription and are dropped, not handed on.

`stop()` rejects new log delivery through the existing disposed/generation guards and waits for scheduled work. It retains the provider listener until `dispose()`, so a host can destroy its owned provider before listener removal starts an unsubscribe. Direct disposal still stops work and removes the listener, including when draining fails.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                     | Specification IDs                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts) | [`REQ-STOR-3-4RJGER`](../../../specification/storage/durability.md#req-stor-3-4rjger), [`REQ-CHAINOBS-3-N137ZP`](../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Role-consistent with the owning views; no divergence observed at this file's boundary.

## Specification contradictions

None demonstrated.

## Missing behavior

**[`DEF-2-SHQR0A`](../../../audit/open-findings.md#def-2-shqr0a) anchor:** `OutboundMessagesProcessed` is absent from the dispatched-event set — local withdrawal accounting can go stale ([open-findings](../../../audit/open-findings.md)).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Gap / divergence |
| ---------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-CHAINOBS-3-N137ZP`](../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp) | Covered               | **Here:** [watchSockets registration](../../../../../src/StateChannelEventListener.ts#L72) subscribes every node socket, holds the watermark for a reopened one at [L92](../../../../../src/StateChannelEventListener.ts#L92), releases it when the socket ends at [L131](../../../../../src/StateChannelEventListener.ts#L131), and runs the catch-up with the first-connected-node fallback in [catchUpUntilRead](../../../../../src/StateChannelEventListener.ts#L197). **Other files:** [EventSyncService](stateManager/eventSync/EventSyncService.ts.md) reads, holds and deduplicates; [RpcNodeProvider](evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md) reconnects and reports a lost socket; [MultiRpcProvider](evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md) serves the fallback read. | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                  | Obligation                               | Public entry and setup                                                            | Oracle and forbidden effects                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-channel-event-listener-1-xhnmvw"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW` | Mode-specific channel-listener ownership | Install a selected-channel filter, then run targeted or ordinary unsigned cleanup | Targeted cleanup retains exact-target delivery; ordinary cleanup removes the filter | <a id="unit-test-state-channel-event-listener-1-xhnmvw.p1"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P1` — retained same-target subscription and event delivery; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p2"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P2` — ordinary clear removes the filter; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p3"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P3` — A real subscribed log delivered while stop is draining is dropped before scheduling; unsubscribe has not yet run; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p4"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P4` — one subscription on every node socket; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p5"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P5` — a node that first connects after startup is subscribed and caught up as reopened; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p6"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P6` — a reopened socket's live logs held until its catch-up scheduled what it read; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p7"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P7` — a failed catch-up retried while the socket stays open; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p8"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P8` — retries stop when their socket drops, and the watermark advances past the missed event; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p9"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P9` — retries stop when the channel is cleared, and a later event moves the watermark; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p10"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P10` — clear unsubscribes every live node socket, a reopened socket stays unsubscribed, select subscribes each once; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p11"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P11` — the watermark is held from the socket hand-over until the catch-up read reaches the head, so a real recovery query that completes later blocks meanwhile does not move it, and it advances once the read finishes; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p12"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P12` — a socket that ends while its catch-up read waits releases the hold at once, so the watermark advances through another node; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p13"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P13` — after the reopened node fails a window while connected, the remaining windows are read through the first connected node, the reopened node is not read again, and the watermark advances; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p14"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P14` — retries stop when the runtime is disposed; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p15"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P15` — two sockets catching up at once keep the watermark until both reads end; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p16"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P16` — a finished catch-up releases the watermark, so it reaches the newest event's block; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p17"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P17` — clearing and selecting the channel again while a catch-up read is still in flight releases its hold at once; <a id="unit-test-state-channel-event-listener-1-xhnmvw.p18"></a>`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P18` — after a failed read, a first connected node behind the reopened node's head reads nothing and the hold stays until it reaches that head, then the read resumes from the failed window. |

## Related source reports

- [EventSyncService](./stateManager/eventSync/EventSyncService.ts.md), [EventHandler](./eventHandlers/EventHandler.ts.md).

## Targeted listener ownership

Targeted selection installs the existing provider subscription before pre-open matching. Unsigned targeted
cleanup retains it, so later `ChannelOpened(target)` still reaches the live runtime. Ordinary derived-ID
cleanup calls `clearChannelId` and removes the filter. Obligations use
[`UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P1`](StateChannelEventListener.ts.md#unit-test-state-channel-event-listener-1-xhnmvw.p1) for retained same-target delivery and `.P2` for ordinary
clear.

Shared operation owners: [channelKey.ts.md](utils/channelKey.ts.md).
