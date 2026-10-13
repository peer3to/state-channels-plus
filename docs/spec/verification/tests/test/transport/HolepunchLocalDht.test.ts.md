# HolepunchLocalDht.test.ts

Test file: [test/transport/HolepunchLocalDht.test.ts](../../../../../../test/transport/HolepunchLocalDht.test.ts)
Exercises: [Holepunch](../../../../implementation/source/src/Holepunch.ts.md), [ProfileManager](../../../../implementation/source/src/ProfileManager.ts.md)

## Overview

Two Node runtimes join one topic through their real `Holepunch` on real Hyperswarm 4.17.2. Their
DHT nodes bootstrap from a private hyperdht testnet on 127.0.0.1, so announce, lookup, dial, the
firewall that refuses a banned peer and the duplicate-connection rule are Hyperswarm's own; no
relay is involved. The fixture records Hyperswarm's firewall verdict on each incoming connection
without changing it. The ban case blacklists the peer through the SDK API, makes both runtimes look
the topic up, and checks that the banning runtime dials nothing and Hyperswarm refuses the banned
peer's dial; it then releases the ban and checks one authenticated connection that carries a
request. The crossing case holds each runtime's incoming connections until that runtime dialed too,
so both release dials cross; it then checks that one connection remains on each side and carries a
request.

## Tests

- `connects two Node runtimes that join one topic at the same moment`: REQ-UPG-7-61PHDB.T1.P7
- `neither dials nor accepts a blacklisted peer while it stays announced, and connects it once after the release`: REQ-UPG-7-61PHDB.T1.P5
- `leaves one working connection that carries requests when both runtimes release their bans and dial each other at the same moment`: REQ-UPG-7-61PHDB.T1.P6
