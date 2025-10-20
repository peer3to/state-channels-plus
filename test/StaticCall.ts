import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("StaticCall", function () {
  it("StaticCall test", async function () {
    const counter = await ethers.deployContract("Counter");

    await counter.inc();
    let value = await counter.x();
    expect(value).to.equal(1n);

    await counter.inc.staticCall();
    value = await counter.x();
    expect(value).to.equal(1n);

    await counter.inc();
    value = await counter.x();
    expect(value).to.equal(2n);
  });
});
