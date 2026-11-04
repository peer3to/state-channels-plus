# RpcMirrorSampling.test.ts

Test file: [test/evm/RpcMirrorSampling.test.ts](../../../../../../test/evm/RpcMirrorSampling.test.ts)
Exercises: [MirrorRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MirrorRpcProvider.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it. Recording proxies sit between the provider and the node and between the provider and the service, so the oracles are the answers the provider returns, the exact requests each of them received, the service pushes the case holds back or withholds and the warnings it logs. Cases that need an account lazy or a snapshot absent run the service with a block source or a held snapshot that produces that status; time-bound cases hold the service's pushes and observe that a read stays pending. The mismatch cases also read what the provider logged of the mismatch, and the dropped-account case writes the account on chain and cuts and restores the service connection after the drop.

This file covers the fraction of local answers re-asked of the node, and what a mismatch does to the account.

## Tests

- `re-asks the node about a sampled read after replying, and keeps the account when the node agrees`: REQ-RPCMIRROR-7-4A6NJN.T1.P1
- `samples balance, nonce and code reads against the node too`: REQ-RPCMIRROR-7-4A6NJN.T1.P2
- `sends nothing to the node at a sample rate of 0`: REQ-RPCMIRROR-7-4A6NJN.T1.P3
- `samples a small fraction of local answers when the provider is built without a sample rate`: REQ-RPCMIRROR-7-4A6NJN.T1.P6
- `reads the account from the node from then on after a mismatch between a cached value and the node`: REQ-RPCMIRROR-7-4A6NJN.T1.P4, REQ-RPCMIRROR-7-4A6NJN.T1.P8
- `checks a sampled eth_call against the node and drops the called account on a mismatch`: REQ-RPCMIRROR-7-4A6NJN.T1.P5, REQ-RPCMIRROR-7-4A6NJN.T1.P9
- `keeps reading a dropped account from the node after a block writes it and after the service connection comes back`: REQ-RPCMIRROR-7-4A6NJN.T1.P7
- `drops the called account when the node reverts a call the mirror returned`: REQ-RPCMIRROR-7-4A6NJN.T1.P10
- `drops every account a sampled call used when the node answers differently, the callee's too`: REQ-RPCMIRROR-7-4A6NJN.T1.P11
