import { expect } from "chai";

import { RelayerPoolFixture } from "@test/fixtures/RelayerPoolFixture";

describe("RelayerPool", function () {
    let fixture: RelayerPoolFixture;

    beforeEach(function () {
        fixture = new RelayerPoolFixture();
    });

    afterEach(function () {
        fixture.cleanup();
    });

    it("returns undefined and schedules nothing for an empty relayer list", function () {
        const pool = fixture.pool([], [0]);

        expect(pool.next()).to.equal(undefined);
        expect(pool.isExhausted).to.equal(false);
        expect(fixture.timerCount()).to.equal(0);
    });

    it("selects only relayers that have not failed in the current round", function () {
        const urls = ["wss://relay-a.example", "wss://relay-b.example"];
        const pool = fixture.pool(urls, [0, 0]);

        pool.onFailure(urls[0], () => undefined);

        expect(pool.next()).to.equal(urls[1]);
    });

    it("uses bounded jitter before retrying another available relayer", function () {
        const urls = ["wss://relay-a.example", "wss://relay-b.example"];
        const pool = fixture.pool(urls, [0.5]);
        let retries = 0;

        pool.onFailure(urls[0], () => {
            retries += 1;
        });
        fixture.tick(124);
        expect(retries).to.equal(0);
        fixture.tick(1);
        expect(retries).to.equal(1);
    });

    it("uses bounded full-pool backoff and resets exclusions after exhaustion", function () {
        const url = "wss://relay.example";
        const pool = fixture.pool([url], [0.5]);
        let retries = 0;

        pool.onFailure(url, () => {
            retries += 1;
        });

        expect(pool.next()).to.equal(url);
        fixture.tick(499);
        expect(retries).to.equal(0);
        fixture.tick(1);
        expect(retries).to.equal(1);
    });

    it("caps repeated full-pool backoff at thirty seconds", function () {
        const url = "wss://relay.example";
        const pool = fixture.pool([url], [1]);
        let retries = 0;

        pool.onFailure(url, () => {
            retries += 1;
        });
        fixture.tick(1000);
        pool.onFailure(url, () => {
            retries += 1;
        });
        fixture.tick(2000);
        pool.onFailure(url, () => {
            retries += 1;
        });
        fixture.tick(4000);
        pool.onFailure(url, () => {
            retries += 1;
        });
        fixture.tick(8000);
        pool.onFailure(url, () => {
            retries += 1;
        });
        fixture.tick(16000);
        pool.onFailure(url, () => {
            retries += 1;
        });
        fixture.tick(29999);
        expect(retries).to.equal(5);
        fixture.tick(1);
        expect(retries).to.equal(6);
    });

    it("clears exclusions and backoff after a successful connection", function () {
        const url = "wss://relay.example";
        const pool = fixture.pool([url], [1]);

        pool.onFailure(url, () => undefined);
        fixture.tick(1000);
        pool.onFailure(url, () => undefined);
        fixture.tick(2000);
        pool.onSuccess();
        pool.onFailure(url, () => undefined);

        fixture.tick(999);
        expect(fixture.timerCount()).to.equal(1);
        fixture.tick(1);
        expect(fixture.timerCount()).to.equal(0);
    });

    it("cancels a pending retry after success", function () {
        const urls = ["wss://relay-a.example", "wss://relay-b.example"];
        const pool = fixture.pool(urls, [0.5, 0]);
        let retries = 0;

        pool.onFailure(urls[0], () => {
            retries += 1;
        });
        pool.onSuccess();
        fixture.tick(250);

        expect(retries).to.equal(0);
        expect(fixture.timerCount()).to.equal(0);
        expect(pool.next()).to.equal(urls[0]);
    });

    it("deduplicates paired error and close failures for one connection", function () {
        const url = "wss://relay.example";
        const pool = fixture.pool([url], [0.5]);
        let retries = 0;

        pool.onFailure(url, () => {
            retries += 1;
        });
        pool.onFailure(url, () => {
            retries += 1;
        });

        expect(fixture.timerCount()).to.equal(1);
        fixture.tick(500);
        expect(retries).to.equal(1);
    });
});
