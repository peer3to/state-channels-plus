import { ATransport } from "./transport";

interface IOnMessage {
    onRpc(serializedRPC: string, transport: ATransport): void;
}

export default IOnMessage;
