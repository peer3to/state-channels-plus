interface IOnMessage {
    onRpc(serializedRPC: string): void;
}

export default IOnMessage;
