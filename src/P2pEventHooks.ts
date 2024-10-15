type P2pEventHooks = {
    onConnection?: (address: string) => void;
    onTurn?: (address: string) => void;
    onSetState?: () => void;
    onPostingCalldata?: () => void;
    onPostedCalldata?: () => void;
    onInitiatingDispute?: () => void;
};

export default P2pEventHooks;
