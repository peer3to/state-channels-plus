import { ethers } from "ethers";
import { EvmStateMachine } from "@peer3/state-channels-plus";
import { createCalculatorPrecompile } from "./precompiles/calculator-precompile";

async function main() {
    //
    // Standard state channel setup
    //
    const provider = new ethers.JsonRpcProvider("http://localhost:8545");
    const signer = await provider.getSigner();

    // Your state machine contract setup
    const MyStateMachine = new ethers.ContractFactory(
        [], // ABI - replace with your actual ABI
        "0x", // Bytecode - replace with your actual bytecode
        signer
    );
    const stateMachine = await MyStateMachine.deploy();
    await stateMachine.waitForDeployment();
    const deployTx = MyStateMachine.getDeployTransaction();

    // Your state channel manager contract
    const stateChannelManager = new ethers.Contract(
        "YOUR_DEPLOYED_ADDRESS",
        [], // ABI - replace with your actual ABI
        signer
    );

    //
    // Precompile Integration
    //

    // Create the calculator precompile - this is where your WASM is loaded and prepared
    const calculatorPrecompile = await createCalculatorPrecompile();

    // Pass the precompile to p2pSetup - this makes it available in your state machine
    const p2p = await EvmStateMachine.p2pSetup(
        signer,
        deployTx,
        stateChannelManager,
        stateMachine,
        {
            onConnection: (address: string) => {
                console.log(`Connected to peer: ${address}`);
            },
            onTurn: (address: string) => {
                console.log(`Turn changed to: ${address}`);
            }
        },
        [calculatorPrecompile] //  precompile is injected here
    );

    // Now your state machine contract can use the precompile

    await p2p.dispose();
}

main().catch(console.error);
