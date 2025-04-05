import { ethers } from "hardhat";
import { expect } from "chai";
import { EVM } from "@ethereumjs/evm";
import * as sinon from "sinon";

import EvmStateMachine from "@/evm/EvmStateMachine";
import { StateMachine } from "@/evm/StateMachine";

import {
    getMathDeploymentTransaction
} from "@test/utils/testHelpers";

describe("EvmStateMachine", function () {
    let mathStateMachine: any;
    let deployTx: any;

    before(async function () {
        mathStateMachine = await ethers.getContractFactory("MathStateMachine");
        deployTx = await getMathDeploymentTransaction(ethers);
    });

    describe("createStandalone", function () {
        it("should successfully create a standalone EvmStateMachine", async function () {
            const evmStateMachine = await EvmStateMachine.createStandalone(
                deployTx,
                mathStateMachine.interface
            );

            expect(evmStateMachine).to.be.instanceOf(EvmStateMachine);
            expect(evmStateMachine.stateMachineInterface).to.not.be.undefined;
            expect(evmStateMachine.contractInterface).to.equal(mathStateMachine.interface);
        });

        it("should fail when deployment transaction is invalid", async function () {
            // Create a mock EVM 
            const mockEvm = {
                runCall: sinon.stub().resolves({
                    // No createdAddress field
                    execResult: { returnValue: Buffer.from('') }
                })
            };

            // Stub EVM.create to return our mock
            sinon.stub(EVM, 'create').resolves(mockEvm as any);

            // Expect an error
            await expect(
                EvmStateMachine.createStandalone({ data: "0x" }, mathStateMachine.interface)
            ).to.be.rejectedWith("EvmStateMachine - create - deploymentTx didn't deploy a contract");

            // Restore the EVM.create method
            sinon.restore();
        });
    });

    describe("processLogs", function () {
        let evmStateMachine: EvmStateMachine;
        let mockContractInstance: any;

        beforeEach(async function () {
            // Create a standalone EVM state machine for each test
            evmStateMachine = await EvmStateMachine.createStandalone(
                deployTx,
                mathStateMachine.interface
            );

            // Create a mock contract instance with emit spy
            mockContractInstance = {
                emit: sinon.spy(),
                interface: mathStateMachine.interface
            };

            // Set mock contract instance
            evmStateMachine.setP2pContractInstance(mockContractInstance);
        });

        it("should process Addition event logs correctly", async function () {
            // Get the Addition event signature from the actual contract
            const additionEventSignature = mathStateMachine.interface.getEvent("Addition").topicHash;

            // Create test logs for Addition event (uint256 a, uint256 b, uint256 result)
            const testLogs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'), // address
                    [
                        // Addition event topic
                        Buffer.from(additionEventSignature.slice(2), 'hex')
                    ],
                    // Encode the event data parameters
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['uint256', 'uint256', 'uint256'],
                        [10, 5, 15]
                    )
                ]
            ];

            // Process the logs
            evmStateMachine.processLogs(testLogs);

            // Verify the event was emitted with correct arguments
            expect(mockContractInstance.emit.called).to.be.true;
            expect(mockContractInstance.emit.firstCall.args[0]).to.equal("Addition");
            expect(mockContractInstance.emit.firstCall.args[1]).to.equal(10n);
            expect(mockContractInstance.emit.firstCall.args[2]).to.equal(5n);
            expect(mockContractInstance.emit.firstCall.args[3]).to.equal(15n);
        });

        it("should process NextToPlay event logs correctly", async function () {
            // Get the NextToPlay event signature from the actual contract
            const nextToPlayEventSignature = mathStateMachine.interface.getEvent("NextToPlay").topicHash;

            // Create a test address for the next player
            const playerAddress = "0x" + "1".repeat(40);

            // Create test logs for NextToPlay event (address player)
            const testLogs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'), // address
                    [
                        // NextToPlay event topic
                        Buffer.from(nextToPlayEventSignature.slice(2), 'hex')
                    ],
                    // Encode the event data parameters
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['address'],
                        [playerAddress]
                    )
                ]
            ];

            // Process the logs
            evmStateMachine.processLogs(testLogs);

            // Verify the event was emitted with correct arguments
            expect(mockContractInstance.emit.called).to.be.true;
            expect(mockContractInstance.emit.firstCall.args[0]).to.equal("NextToPlay");
            expect(mockContractInstance.emit.firstCall.args[1].toLowerCase()).to.equal(playerAddress.toLowerCase());
        });

        it("should process multiple event logs in order", async function () {
            // Get the event signatures
            const additionEventSignature = mathStateMachine.interface.getEvent("Addition").topicHash;
            const nextToPlayEventSignature = mathStateMachine.interface.getEvent("NextToPlay").topicHash;

            // Create a test address
            const playerAddress = "0x" + "1".repeat(40);

            // Create test logs with multiple events
            const testLogs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'),
                    [Buffer.from(additionEventSignature.slice(2), 'hex')],
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['uint256', 'uint256', 'uint256'],
                        [10, 5, 15]
                    )
                ],
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'),
                    [Buffer.from(nextToPlayEventSignature.slice(2), 'hex')],
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ['address'],
                        [playerAddress]
                    )
                ]
            ];

            // Process the logs
            evmStateMachine.processLogs(testLogs);

            // Verify both events were emitted in order
            expect(mockContractInstance.emit.calledTwice).to.be.true;

            // First event should be Addition
            expect(mockContractInstance.emit.firstCall.args[0]).to.equal("Addition");
            expect(mockContractInstance.emit.firstCall.args[1]).to.equal(10n);
            expect(mockContractInstance.emit.firstCall.args[2]).to.equal(5n);
            expect(mockContractInstance.emit.firstCall.args[3]).to.equal(15n);

            // Second event should be NextToPlay
            expect(mockContractInstance.emit.secondCall.args[0]).to.equal("NextToPlay");
            expect(mockContractInstance.emit.secondCall.args[1].toLowerCase()).to.equal(playerAddress.toLowerCase());
        });

        it("should handle empty logs gracefully", function () {
            // Process empty logs and undefined logs
            evmStateMachine.processLogs([]);
            evmStateMachine.processLogs();

            // Verify emit was not called
            expect(mockContractInstance.emit.called).to.be.false;
        });

        it("should handle malformed logs gracefully", function () {
            // Create malformed logs (missing topics)
            const malformedLogs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'),
                    [], // Empty topics array
                    Buffer.from('some data', 'utf8')
                ]
            ];

            // This should not throw
            expect(() => evmStateMachine.processLogs(malformedLogs)).to.not.throw();

            // Create logs with topic that doesn't match any event
            const unknownTopicLogs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'),
                    [Buffer.from('unknown topic', 'utf8')],
                    Buffer.from('some data', 'utf8')
                ]
            ];

            // This should not throw
            expect(() => evmStateMachine.processLogs(unknownTopicLogs)).to.not.throw();
        });

        it("should handle logs when p2pContractInstance is not set", function () {
            // Create a new EvmStateMachine without setting p2pContractInstance
            const standaloneMachine = new EvmStateMachine(
                {} as StateMachine,
                mathStateMachine.interface
            );

            // Create valid logs
            const validLogs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'),
                    [Buffer.from(mathStateMachine.interface.getEvent("Addition").topicHash.slice(2), 'hex')],
                    ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'uint256'], [10, 5, 15])
                ]
            ];

            // This should not throw
            expect(() => standaloneMachine.processLogs(validLogs)).to.not.throw();
        });

        it("should handle parsing errors without crashing", function () {
            // Create a contract interface that throws errors when parsing logs
            const errorInterface = {
                parseLog: sinon.stub().throws(new Error("Error parsing log"))
            };

            // Set a contract instance with the error interface
            mockContractInstance.interface = errorInterface;

            // Create some logs
            const logs = [
                [
                    Buffer.from('1234567890123456789012345678901234567890', 'hex'),
                    [Buffer.from('some topic', 'utf8')],
                    Buffer.from('data', 'utf8')
                ]
            ];

            // This should not throw
            expect(() => evmStateMachine.processLogs(logs)).to.not.throw();

            // The emit function should not have been called
            expect(mockContractInstance.emit.called).to.be.false;
        });
    });


});
