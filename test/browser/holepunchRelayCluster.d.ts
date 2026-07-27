export type RelayEndpointName = "a" | "b";

export interface HolepunchRelayClusterStats {
    endpoints: Record<
        RelayEndpointName,
        {
            activeConnections: number;
            totalConnections: number;
            connectionTimestamps: number[];
            running: boolean;
            url: string;
        }
    >;
    topicAnnounceCounts: Record<string, number>;
}

export interface HolepunchRelayCluster {
    urls: Record<RelayEndpointName, string>;
    start(name: RelayEndpointName): Promise<void>;
    stop(name: RelayEndpointName): Promise<void>;
    disconnectClients(name: RelayEndpointName): void;
    pauseClientSockets(name: RelayEndpointName): void;
    stats(): HolepunchRelayClusterStats;
    close(): Promise<void>;
}

export function startHolepunchRelayCluster(options?: {
    host?: string;
}): Promise<HolepunchRelayCluster>;
