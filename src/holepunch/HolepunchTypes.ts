import type { Buffer } from "buffer";

import type P2PManager from "@/P2PManager";

export type RelayerUrl = string;
export type TopicKey = string;

export interface HolepunchConnectionSocket {
    readyState?: unknown;
    on(event: "data", listener: (data: Uint8Array) => void): unknown;
    on(event: "close", listener: () => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    write(data: string): void;
    destroy(): void;
}

export interface HolepunchPeerInfo {
    ban(value: boolean): void;
}

export type HolepunchConnectionListener = (
    socket: HolepunchConnectionSocket,
    info: HolepunchPeerInfo
) => void;

export interface HolepunchSwarm {
    destroyed?: boolean;
    on(event: "connection", listener: HolepunchConnectionListener): unknown;
    off(event: "connection", listener: HolepunchConnectionListener): unknown;
    listenerCount?(event: "connection"): number;
    join(topic: Buffer, options: { server: boolean; client: boolean }): unknown;
    leave(topic: Buffer): Promise<unknown> | unknown;
    destroy(): Promise<unknown> | unknown;
    topics?(): Iterable<unknown>;
}

export type HolepunchSwarmUpdate = (swarm: HolepunchSwarm) => void;

export interface HolepunchRuntime {
    start(): void;
    dispose(): Promise<void>;
}

export type CreateHolepunchRuntime = (
    p2pManager: P2PManager,
    onSwarm: HolepunchSwarmUpdate
) => HolepunchRuntime;

export interface RelaySocketHandlers {
    open: () => void;
    close: () => void;
    error: (error: unknown) => void;
}

export interface RelaySocket {
    setHandlers(handlers: RelaySocketHandlers): void;
    clearHandlers(): void;
    close(): void;
}

export interface HolepunchRelayResources {
    socket: RelaySocket;
    dht: unknown;
    swarm: HolepunchSwarm;
    destroy(): Promise<void>;
}

export interface HolepunchRelayConnectionFactory {
    create(relayerUrl: RelayerUrl): HolepunchRelayResources;
}
