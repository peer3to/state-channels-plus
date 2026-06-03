export class LocalDiscoveryServer {
    static setLogger(_logger: unknown): void {}

    static setRegistryPort(_port: number): void {}

    static async tryStart(): Promise<boolean> {
        return false;
    }

    static async connectToPeers(
        _p2pManager: unknown,
        _channelId: unknown,
        _myPeerAddress: string
    ): Promise<void> {
        throw new Error("LocalDiscoveryServer is only available in Node.js");
    }

    static async cleanup(): Promise<void> {}
}
