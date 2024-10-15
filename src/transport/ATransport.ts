abstract class ATransport {
    abstract send(serializedRPC: string): void;
    abstract onMessage(data: any): void;
    abstract close(): void;
}
export default ATransport;
