# LocalDiscoveryServer.test.ts

Test file: [test/utils/LocalDiscoveryServer.test.ts](../../../../../../test/utils/LocalDiscoveryServer.test.ts)
Exercises: [LocalDiscoveryServer.ts](../../../../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md)

## Overview

These component cases run real loopback discovery and real authenticated `P2PManager` instances. They compare
transport identities across an explicit raw close, prove that close does not blacklist the remote identity,
then observe the same topic after leave or explicit blacklist. The tests
exercise the production session, canonical dialer, retry timer, handshake, and blacklist checks; no synthetic
transport or precomputed result boolean stands in for discovery.

The late-ready case holds a real accepted socket, disposes its manager, then sends the valid wire frame. It asserts socket closure with no acknowledgement and no remaining transports.

The pending-dial shutdown case delays every handshake reply on both inline peers, waits until one runtime has a real dial in flight, and runs that runtime's `StateManager.stop`, the first half of shutdown that settles its handshake wait with `false` while its P2P manager and discovery session are still alive. It asserts the manager is not yet disposed and that no peer retry count was written, which is where a retry records itself together with its warning and timer.

The pending-close rejoin case stops the acceptor reading its accepted sockets, so the dialer's closed socket stays closing; the dialer leaves, closes its transport and rejoins the topic, and must authenticate a different transport before the old socket finishes closing.

The replacement-endpoint cases use real listener leave/rejoin and registry advertisements while the old socket is either awaiting handshake or authenticated. They close only that obsolete listener’s sockets and require a different authenticated transport, one live connection, and no blacklist. The real dialer, deduplication and retry paths execute.

## Tests

- `redials an eligible disconnected peer no sooner than a second later while the topic remains observed and stops after leave`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P5, UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P6, REQ-LOBBY-9-N894C0.T1.P13, REQ-LOBBY-9-N894C0.T1.P18
- `does not redial a peer blacklisted before its transport closes`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P7, REQ-LOBBY-9-N894C0.T1.P16
- `deduplicates an in-flight dial across topics before authentication`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P10
- `dials the peer again after a leave and rejoin while the left topic's closed socket has not finished closing`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P17
- `does not dial a peer that already has a live authenticated transport on another topic`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P8
- `repeated and concurrent joins share one listener and a pending join can be left`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P9, REQ-LOBBY-9-N894C0.T1.P17
- `closes an accepted socket whose ready frame arrives after manager disposal`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P11
- `holds an inbound reconnect inside the cooldown after the previous transport closed and admits it once the cooldown has passed, without blacklisting`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P13, REQ-LOBBY-9-N894C0.T1.P19
- `schedules no retry for a local dial whose handshake is pending when its runtime shuts down`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P14
- `retries the replacement endpoint announced while the old endpoint handshake is pending`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P15, REQ-LOBBY-9-N894C0.T1.P24
- `retries the replacement endpoint announced while the old authenticated transport is still connected`: UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P16, REQ-LOBBY-9-N894C0.T1.P25
