import { ATransport } from "./transport";

interface IOnMessage {
    onRpc(serializedRPC: string, transport: ATransport): Promise<void>;
}

export default IOnMessage;
