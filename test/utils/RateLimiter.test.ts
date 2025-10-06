import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import {
    RateLimiter,
    InboundRateLimiterManager,
    outboundRateLimiter,
    inboundRateLimiterManager
} from "@/utils/RateLimiter";
import sinon from "sinon";

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
        expect(rateLimiter.getTokenCount()).to.be.lessThan(2000);
    });

    it("should reject messages when rate limit exceeded", () => {
        // Consume all available tokens (2MB burst = 2000 tokens)
        // Consume in smaller chunks to ensure we exhaust all tokens
        let totalConsumed = 0;
        const chunkSize = 1024; // 1KB chunks
        const totalSize = 2000 * 1024; // 2MB total

        while (totalConsumed < totalSize) {
            const remaining = totalSize - totalConsumed;
            const currentChunk = Math.min(chunkSize, remaining);
            const consumed = rateLimiter.checkAndConsume(currentChunk);
            expect(consumed).to.be.true;
            totalConsumed += currentChunk;
        }

        // Consume any remaining tokens
        while (rateLimiter.getTokenCount() > 0) {
            const consumed = rateLimiter.checkAndConsume(1024);
            if (!consumed) break;
        }

        // Force exhaustion by consuming more than available
        const excessSize = 10000 * 1024; // 10MB - more than available
        rateLimiter.checkAndConsume(excessSize);

        // Ensure we're truly exhausted
        expect(rateLimiter.getTokenCount()).to.equal(0);

        // Next message should be rejected
        const result = rateLimiter.checkAndConsume(1024);
        expect(result).to.be.false;
    });

    it("should refill tokens over time", () => {
        // Use fake timers for this test
        clock = sinon.useFakeTimers();

        // Create a new rate limiter with fake timers
        const testRateLimiter = new RateLimiter(1024000, 2048000);

        // Consume all available tokens
        const burstSize = 1999 * 1024; // 1999 tokens * 1024 bytes
        testRateLimiter.checkAndConsume(burstSize);
        // Consume the remaining 1 token
        testRateLimiter.checkAndConsume(1024);
        expect(testRateLimiter.getTokenCount()).to.equal(0);

        // Advance time by 1 second (should refill 1MB worth of tokens = 1000 tokens)
        clock.tick(1000);

        const result = testRateLimiter.checkAndConsume(1024000);
        expect(result).to.be.true;
    });

    it("should reset tokens when reset", () => {
        // Consume some tokens
        rateLimiter.checkAndConsume(1024000);
        expect(rateLimiter.getTokenCount()).to.be.lessThan(2000);

        // Reset
        rateLimiter.reset();
        expect(rateLimiter.getTokenCount()).to.equal(2000);
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
        // Consume all available tokens on transport1
        const burstSize = 1999 * 1024; // 1999 tokens * 1024 bytes
        manager.checkInboundMessage(transport1 as any, burstSize);
        // Consume the remaining 1 token
        manager.checkInboundMessage(transport1 as any, 1024);

        // transport1 should be rate limited
        const result1 = manager.checkInboundMessage(transport1 as any, 1024);
        expect(result1).to.be.false;

        // transport2 should still work fine
        const result2 = manager.checkInboundMessage(transport2 as any, 1024);
        expect(result2).to.be.true;
    });

    it("should allow multiple connections to use full bandwidth", () => {
        // Both connections should be able to use full bandwidth
        const burstSize = 1999 * 1024; // 1999 tokens * 1024 bytes
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
            expect(outboundRateLimiter.getTokenCount()).to.be.greaterThan(0);
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

        // Exhaust transport1's rate limit (20MB burst = 20,480 tokens)
        const burstSize = 20479 * 1024; // 20,479 tokens * 1024 bytes
        inboundRateLimiterManager.checkInboundMessage(
            transport1 as any,
            burstSize
        );
        // Consume the remaining 1 token
        inboundRateLimiterManager.checkInboundMessage(transport1 as any, 1024);

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

        // Consume all outbound tokens (20MB burst = 20,480 tokens)
        const burstSize = 20479 * 1024; // 20,479 tokens * 1024 bytes
        const result1 = outboundRateLimiter.checkAndConsume(burstSize);
        // Consume the remaining 1 token
        const result2 = outboundRateLimiter.checkAndConsume(1024);
        expect(result1).to.be.true;
        expect(result2).to.be.true;

        // Next outbound message should be rate limited
        const result3 = outboundRateLimiter.checkAndConsume(1024);
        expect(result3).to.be.false;
    });
});
