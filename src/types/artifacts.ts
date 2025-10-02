export interface Artifact {
    _format: string;
    contractName: string;
    sourceName: string;
    abi: any[];
    bytecode?: string;
    deployedBytecode?: string;
    linkReferences?: any;
    deployedLinkReferences?: any;
}
