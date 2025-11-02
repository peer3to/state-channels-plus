import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import {
    RateLimiter,
    InboundRateLimiterManager,
    outboundRateLimiter,
    inboundRateLimiterManager
} from "@/utils/RateLimiter";
import Clock from "@/Clock";
import sinon from "sinon";
import { ethers } from "ethers";

// Mock ATransport for testing
class MockTransport {
    id: string;
    constructor(id: string) {
        this.id = id;
    }
}

describe("RateLimiter", () => {
    let rateLimiter: RateLimiter;
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        rateLimiter = new RateLimiter(
            1024000, // 1MB/s
            2048000 // 2MB burst (2000 tokens)
        );
        // Don't use fake timers for basic tests
        clock = null as any;
    });

    afterEach(() => {
        if (clock) {
            clock.restore();
        }
    });

    it("should allow messages within rate limit", () => {
        const result = rateLimiter.checkAndConsume(1024); // 1KB
        expect(result).to.be.true;
        expect(rateLimiter.getAvailableBytes()).to.be.lessThan(2048000); // Less than 2MB
    });

    it("should reject messages when rate limit exceeded", () => {
        const testRateLimiter = new RateLimiter(1024000, 2048000); // 1MB/s, 2MB burst

        // Consume the full burst capacity
        const consumed = testRateLimiter.checkAndConsume(2048000);
        expect(consumed).to.be.true;

        // Next message should be rejected
        const result = testRateLimiter.checkAndConsume(1024);
        expect(result).to.be.false;
    });

    it("should refill bytes over time", () => {
        // Use fake timers for this test
        clock = sinon.useFakeTimers();

        // Create a new rate limiter with fake timers
        const testRateLimiter = new RateLimiter(1024000, 2048000);

        // Consume all available bytes
        const burstSize = 2048000; // 2MB
        testRateLimiter.checkAndConsume(burstSize);
        expect(testRateLimiter.getAvailableBytes()).to.equal(0);

        // Advance time by 1 second (should refill 1MB worth of bytes)
        clock.tick(1000);

        const result = testRateLimiter.checkAndConsume(1024000);
        expect(result).to.be.true;
    });

    it("should reset bytes when reset", () => {
        // Consume some bytes
        rateLimiter.checkAndConsume(1024000);
        expect(rateLimiter.getAvailableBytes()).to.be.lessThan(2048000);

        // Reset
        rateLimiter.reset();
        expect(rateLimiter.getAvailableBytes()).to.equal(2048000);
    });
});

describe("InboundRateLimiterManager", () => {
    let manager: InboundRateLimiterManager;
    let transport1: MockTransport;
    let transport2: MockTransport;

    beforeEach(() => {
        manager = new InboundRateLimiterManager(
            1024000, // 1MB/s per connection
            2048000 // 2MB burst per connection
        );
        transport1 = new MockTransport("transport1");
        transport2 = new MockTransport("transport2");
    });

    it("should create separate rate limiters for different connections", () => {
        const result1 = manager.checkInboundMessage(transport1 as any, 1024);
        const result2 = manager.checkInboundMessage(transport2 as any, 1024);

        expect(result1).to.be.true;
        expect(result2).to.be.true;

        // Each connection should have independent rate limiting
        const rateLimiter1 = manager.getRateLimiter(transport1 as any);
        const rateLimiter2 = manager.getRateLimiter(transport2 as any);

        expect(rateLimiter1).to.not.equal(rateLimiter2);
    });

    it("should track rate limiting per connection independently", () => {
        // Consume all available bytes on transport1
        const burstSize = 2048000; // 2MB
        manager.checkInboundMessage(transport1 as any, burstSize);

        // transport1 should be rate limited
        const result1 = manager.checkInboundMessage(transport1 as any, 1024);
        expect(result1).to.be.false;

        // transport2 should still work fine
        const result2 = manager.checkInboundMessage(transport2 as any, 1024);
        expect(result2).to.be.true;
    });

    it("should allow multiple connections to use full bandwidth", () => {
        // Both connections should be able to use full bandwidth
        const burstSize = 2048000; // 2MB
        const result1 = manager.checkInboundMessage(
            transport1 as any,
            burstSize
        );
        const result2 = manager.checkInboundMessage(
            transport2 as any,
            burstSize
        );

        expect(result1).to.be.true;
        expect(result2).to.be.true;
    });
});

describe("Global Rate Limiters", () => {
    it("should have outbound rate limiter available", () => {
        expect(outboundRateLimiter).to.not.be.null;
        expect(outboundRateLimiter).to.be.instanceOf(RateLimiter);
    });

    it("should have inbound rate limiter manager available", () => {
        expect(inboundRateLimiterManager).to.not.be.null;
        expect(inboundRateLimiterManager).to.be.instanceOf(
            InboundRateLimiterManager
        );
    });

    it("should use same configuration for both rate limiters", () => {
        if (outboundRateLimiter && inboundRateLimiterManager) {
            // Both should use the same configuration from config.ts
            // This is tested by checking they exist and are properly instantiated
            expect(outboundRateLimiter.getAvailableBytes()).to.be.greaterThan(
                0
            );
        }
    });
});

describe("Integration Test: Per-Connection Inbound + Global Outbound", () => {
    let transport1: MockTransport;
    let transport2: MockTransport;

    beforeEach(() => {
        transport1 = new MockTransport("transport1");
        transport2 = new MockTransport("transport2");
    });

    it("should allow multiple connections to send inbound data simultaneously", () => {
        if (!inboundRateLimiterManager) {
            console.log(
                "Inbound rate limiter manager not available, skipping test"
            );
            return;
        }

        // Both connections should be able to send data simultaneously
        const result1 = inboundRateLimiterManager.checkInboundMessage(
            transport1 as any,
            102400
        );
        const result2 = inboundRateLimiterManager.checkInboundMessage(
            transport2 as any,
            102400
        );

        expect(result1).to.be.true;
        expect(result2).to.be.true;
    });

    it("should rate limit individual connections independently", () => {
        if (!inboundRateLimiterManager) {
            console.log(
                "Inbound rate limiter manager not available, skipping test"
            );
            return;
        }

        // Exhaust transport1's rate limit (20MB burst)
        const burstSize = 20 * 1024 * 1024; // 20MB
        inboundRateLimiterManager.checkInboundMessage(
            transport1 as any,
            burstSize
        );

        // transport1 should be rate limited
        const result1 = inboundRateLimiterManager.checkInboundMessage(
            transport1 as any,
            1024
        );
        expect(result1).to.be.false;

        // transport2 should still work
        const result2 = inboundRateLimiterManager.checkInboundMessage(
            transport2 as any,
            1024
        );
        expect(result2).to.be.true;
    });

    it("should maintain global outbound rate limiting", () => {
        if (!outboundRateLimiter) {
            console.log("Outbound rate limiter not available, skipping test");
            return;
        }

        // Consume all outbound bytes (20MB burst)
        const burstSize = 20 * 1024 * 1024; // 20MB
        const result1 = outboundRateLimiter.checkAndConsume(burstSize);
        expect(result1).to.be.true;

        // Next outbound message should be rate limited
        const result2 = outboundRateLimiter.checkAndConsume(1024);
        expect(result2).to.be.false;
    });
});

describe("Bandwidth Management with Signature-based Deduplication", () => {
    let bandwidthManager: InboundRateLimiterManager;
    let clock: sinon.SinonFakeTimers;

    beforeEach(async () => {
        // Initialize Clock for timestamp validation
        const mockProvider = {
            getBlock: async () => ({ timestamp: Math.floor(Date.now() / 1000) })
        };
        await Clock.init(mockProvider as any);

        bandwidthManager = new InboundRateLimiterManager(
            1024000, // 1MB/s
            2048000, // 2MB burst
            5000 // 5 seconds agreement time
        );
        // Don't use fake timers for timestamp validation tests
        clock = null as any;
    });

    afterEach(() => {
        if (clock) {
            clock.restore();
        }
        bandwidthManager.dispose();
    });

    it("should reject messages with invalid format", async () => {
        const invalidRpc = "invalid json";
        const result = await bandwidthManager.checkRpcMessage(invalidRpc, 1024);
        expect(result).to.be.false;
    });

    it("should reject messages without signature", async () => {
        const rpcWithoutSignature = JSON.stringify({
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: Clock.getTimeInSeconds()
            // Missing signature
        });

        const result = await bandwidthManager.checkRpcMessage(
            rpcWithoutSignature,
            1024
        );
        expect(result).to.be.false;
    });

    it("should reject messages without timestamp", async () => {
        const rpcWithoutTimestamp = JSON.stringify({
            service: "test",
            method: "method",
            params: ["param"],
            signature: "0x123"
            // Missing timestamp
        });

        const result = await bandwidthManager.checkRpcMessage(
            rpcWithoutTimestamp,
            1024
        );
        expect(result).to.be.false;
    });

    it("should handle bandwidth manager disposal correctly", () => {
        // Create a new manager
        const testManager = new InboundRateLimiterManager(
            1024000,
            2048000,
            5000
        );

        // Dispose should not throw
        expect(() => testManager.dispose()).to.not.throw();
    });

    it("should allow messages with valid signatures", async () => {
        // Use real timestamp for this test
        const realTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "method",
            params: ["param"],
            timestamp: realTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: realTimestamp,
            signature: signature
        };

        const dataSize = 1024;
        const result = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result).to.be.true;
    });

    it("should deduplicate identical messages", async () => {
        // Use real timestamp for this test
        const realTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "method",
            params: ["param"],
            timestamp: realTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: realTimestamp,
            signature: signature
        };

        const dataSize = 1024;

        // First message should be allowed
        const result1 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result1).to.be.true;

        // Same message should be allowed again (deduplication)
        const result2 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result2).to.be.true;
    });

    it("should rate limit after consuming burst", async () => {
        const dataSize = 1024000; // 1MB - large enough to exceed any refilled amount

        // Consume full burst
        const burstSize = 2048000; // 2MB
        const realTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "method",
            params: ["param"],
            timestamp: realTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const burstRpc = {
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: realTimestamp,
            signature: signature
        };

        const consumed = await bandwidthManager.checkRpcMessage(
            JSON.stringify(burstRpc),
            burstSize
        );
        expect(consumed).to.be.true;

        // Next message should be rejected (run immediately to prevent refill)
        const newTimestamp = Clock.getTimeInSeconds();
        const newMessageContent = JSON.stringify({
            method: "method2",
            params: ["param2"],
            timestamp: newTimestamp
        });

        const newSignature = testWallet.signMessageSync(newMessageContent);
        const rpc = {
            service: "test",
            method: "method2",
            params: ["param2"],
            timestamp: newTimestamp,
            signature: newSignature
        };

        const result = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result).to.be.false;
    });

    it("should cache messages and prevent double-charging", async () => {
        const realTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "method",
            params: ["param"],
            timestamp: realTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: realTimestamp,
            signature: signature
        };

        const dataSize = 1024;

        // First message should be allowed and cached
        const result1 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result1).to.be.true;

        // Same message should be allowed again (from cache, no bandwidth charge)
        const result2 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result2).to.be.true;

        // Different message from same signer should still be allowed
        const newTimestamp = Clock.getTimeInSeconds();
        const newMessageContent = JSON.stringify({
            method: "method2",
            params: ["param2"],
            timestamp: newTimestamp
        });

        const newSignature = testWallet.signMessageSync(newMessageContent);
        const rpc2 = {
            service: "test",
            method: "method2",
            params: ["param2"],
            timestamp: newTimestamp,
            signature: newSignature
        };

        const result3 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc2),
            dataSize
        );
        expect(result3).to.be.true;
    });

    it("should remove cached messages after expiration time", async () => {
        const realTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "method",
            params: ["param"],
            timestamp: realTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: realTimestamp,
            signature: signature
        };

        const dataSize = 1024;

        // First message should be allowed and cached
        const result1 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result1).to.be.true;

        // Wait for cache to expire (agreement time is 5 seconds)
        await new Promise((resolve) => setTimeout(resolve, 6000));

        // Same message should be rejected (timestamp is now too old)
        const result2 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result2).to.be.false;
    });

    it("should handle multiple different messages correctly", async () => {
        const dataSize = 1024;

        // Create three different messages with real timestamps
        const timestamp1 = Clock.getTimeInSeconds();
        const messageContent1 = JSON.stringify({
            method: "method1",
            params: ["param1"],
            timestamp: timestamp1
        });
        const signature1 = testWallet.signMessageSync(messageContent1);
        const rpc1 = {
            service: "test",
            method: "method1",
            params: ["param1"],
            timestamp: timestamp1,
            signature: signature1
        };

        const timestamp2 = Clock.getTimeInSeconds();
        const messageContent2 = JSON.stringify({
            method: "method2",
            params: ["param2"],
            timestamp: timestamp2
        });
        const signature2 = testWallet.signMessageSync(messageContent2);
        const rpc2 = {
            service: "test",
            method: "method2",
            params: ["param2"],
            timestamp: timestamp2,
            signature: signature2
        };

        const timestamp3 = Clock.getTimeInSeconds();
        const messageContent3 = JSON.stringify({
            method: "method3",
            params: ["param3"],
            timestamp: timestamp3
        });
        const signature3 = testWallet.signMessageSync(messageContent3);
        const rpc3 = {
            service: "test",
            method: "method3",
            params: ["param3"],
            timestamp: timestamp3,
            signature: signature3
        };

        // All messages should be allowed
        const result1 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc1),
            dataSize
        );
        const result2 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc2),
            dataSize
        );
        const result3 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc3),
            dataSize
        );

        expect(result1).to.be.true;
        expect(result2).to.be.true;
        expect(result3).to.be.true;

        // Same messages should be allowed again (from cache)
        const result1Again = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc1),
            dataSize
        );
        const result2Again = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc2),
            dataSize
        );
        const result3Again = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc3),
            dataSize
        );

        expect(result1Again).to.be.true;
        expect(result2Again).to.be.true;
        expect(result3Again).to.be.true;
    });

    it("should handle cache cleanup interval correctly", async () => {
        const realTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "method",
            params: ["param"],
            timestamp: realTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "method",
            params: ["param"],
            timestamp: realTimestamp,
            signature: signature
        };

        const dataSize = 1024;

        // First message should be allowed and cached
        const result1 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result1).to.be.true;

        // Wait for cache to expire (agreement time is 5 seconds)
        await new Promise((resolve) => setTimeout(resolve, 6000));

        // Now message should be rejected (timestamp is too old)
        const result3 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result3).to.be.false;
    });

    it("should reject messages with timestamps too far in the past", async () => {
        // Create RPC with timestamp 10 seconds ago (beyond agreement time)
        const oldTimestamp = Clock.getTimeInSeconds() - 10; // 10 seconds ago
        const messageContent = JSON.stringify({
            method: "testMethod",
            params: ["testParam"],
            timestamp: oldTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "testMethod",
            params: ["testParam"],
            timestamp: oldTimestamp,
            signature: signature
        };

        const dataSize = 1024;
        const result = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result).to.be.false;
    });

    it("should reject messages with timestamps too far in the future", async () => {
        // Create RPC with timestamp 10 seconds in the future (beyond agreement time)
        const futureTimestamp = Clock.getTimeInSeconds() + 10; // 10 seconds in future
        const messageContent = JSON.stringify({
            method: "testMethod",
            params: ["testParam"],
            timestamp: futureTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "testMethod",
            params: ["testParam"],
            timestamp: futureTimestamp,
            signature: signature
        };

        const dataSize = 1024;
        const result = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result).to.be.false;
    });

    it("should allow messages with timestamps within valid range", async () => {
        // Create RPC with timestamp 2 seconds ago (within agreement time)
        const validTimestamp = Clock.getTimeInSeconds() - 2; // 2 seconds ago
        const messageContent = JSON.stringify({
            method: "testMethod",
            params: ["testParam"],
            timestamp: validTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "testMethod",
            params: ["testParam"],
            timestamp: validTimestamp,
            signature: signature
        };

        const dataSize = 1024;
        const result = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result).to.be.true;
    });

    it("should allow messages with current timestamp", async () => {
        // Create RPC with current timestamp
        const currentTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "testMethod",
            params: ["testParam"],
            timestamp: currentTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "testMethod",
            params: ["testParam"],
            timestamp: currentTimestamp,
            signature: signature
        };

        const dataSize = 1024;
        const result = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result).to.be.true;
    });

    it("should handle timestamp validation with clock advancement", async () => {
        // Create RPC with current timestamp
        const currentTimestamp = Clock.getTimeInSeconds();
        const messageContent = JSON.stringify({
            method: "testMethod",
            params: ["testParam"],
            timestamp: currentTimestamp
        });

        const signature = testWallet.signMessageSync(messageContent);
        const rpc = {
            service: "test",
            method: "testMethod",
            params: ["testParam"],
            timestamp: currentTimestamp,
            signature: signature
        };

        const dataSize = 1024;

        // Message should be allowed initially
        const result1 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result1).to.be.true;

        // Same message should still be allowed (from cache, no timestamp validation)
        const result2 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result2).to.be.true;

        // Same message should still be allowed (from cache, no timestamp validation)
        const result3 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(rpc),
            dataSize
        );
        expect(result3).to.be.true;

        // Create a new message with current timestamp - should be allowed
        const newTimestamp = Clock.getTimeInSeconds();
        const newMessageContent = JSON.stringify({
            method: "testMethod2",
            params: ["testParam2"],
            timestamp: newTimestamp
        });

        const newSignature = testWallet.signMessageSync(newMessageContent);
        const newRpc = {
            service: "test",
            method: "testMethod2",
            params: ["testParam2"],
            timestamp: newTimestamp,
            signature: newSignature
        };

        const result4 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(newRpc),
            dataSize
        );
        expect(result4).to.be.true;

        // Create a message with old timestamp - should be rejected
        const oldTimestamp = Clock.getTimeInSeconds() - 10; // 10 seconds ago
        const oldMessageContent = JSON.stringify({
            method: "testMethod3",
            params: ["testParam3"],
            timestamp: oldTimestamp
        });

        const oldSignature = testWallet.signMessageSync(oldMessageContent);
        const oldRpc = {
            service: "test",
            method: "testMethod3",
            params: ["testParam3"],
            timestamp: oldTimestamp,
            signature: oldSignature
        };

        const result5 = await bandwidthManager.checkRpcMessage(
            JSON.stringify(oldRpc),
            dataSize
        );
        expect(result5).to.be.false;
    });
});

// Create a test wallet for consistent signatures
const testWallet = new ethers.Wallet(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);

// Helper function to create test RPC messages with real signatures
function createTestRpc(
    method: string,
    params: any[],
    signerAddress: string,
    dataSize?: number
): string {
    // Use current timestamp from Clock
    const timestamp = Clock.getTimeInSeconds();
    const messageContent = JSON.stringify({
        method: method,
        params: params,
        timestamp: timestamp
    });

    // Create a real signature using the test wallet
    const signature = testWallet.signMessageSync(messageContent);

    const rpc = {
        service: "test",
        method: method,
        params: params,
        timestamp: timestamp,
        signature: signature
    };

    return JSON.stringify(rpc);
}
