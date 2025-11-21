import { expect } from "chai";
import { network } from "hardhat";
import { ComplexTypeStructOutput } from "../types/ethers-contracts/Counter.js";

const { ethers } = await network.connect();

describe("StaticCall", function () {
  it("StaticCall test", async function () {
    const counter = await ethers.deployContract("Counter");

    await counter.inc();
    let value = await counter.x();
    expect(value).to.equal(1n);

    let sValue = await counter.inc.staticCall();
    value = await counter.x();
    expect(value).to.equal(1n);
    expect(sValue).to.equal(2n);

    await counter.inc();
    value = await counter.x();
    expect(value).to.equal(2n);
  });

  it("StaticCall handles complex return type", async function () {
    const counter = await ethers.deployContract("Counter");

    const initialComplex = await counter.complex();
    expect(initialComplex.a).to.equal(0n);
    expect(initialComplex.b).to.equal(0n);
    const staticResult = await counter.setComplex.staticCall(10n, 20n);
    expect(staticResult.a).to.equal(10n);
    expect(staticResult.b).to.equal(20n);

    const afterStaticCall = await counter.complex();
    expect(afterStaticCall.a).to.equal(0n);
    expect(afterStaticCall.b).to.equal(0n);

    await counter.setComplex(5n, 6n);
    const updatedComplex = await counter.complex();
    expect(updatedComplex.a).to.equal(5n);
    expect(updatedComplex.b).to.equal(6n);
  });
});
