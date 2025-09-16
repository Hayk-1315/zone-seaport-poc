const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Tiny helper: build the ERC-1155 tokenId exactly like the core packing does
// Layout: VVVV...00000 | (outcomeIndex << 32) | timeslot
// - vmId must have its lower 5 bytes = 0 (that's why we shift left by 40 bits when creating it)
// - outcomeIndex is 1 byte
// - timeslot is 4 bytes


// Compare listings by "price per WP" (cheapest wins).
// We avoid floats: (askUSDC * 1e18) / WP → same scale for everyone, we only need ordering.
function pricePerWP(askUSDC_6dec, wpUnits) {
  return (askUSDC_6dec * 10n ** 18n) / wpUnits;
}

describe("WP orderbook (manual selection)", function () {
  it("ranks listings by USDC/WP and 'buys' the cheapest one", async function () {
    const [deployer, alice, bob, carol] = await ethers.getSigners();

    // Deploy our ERC-1155
    const WP = await ethers.getContractFactory("WPERC1155");
    const wp = await WP.deploy();
    await wp.waitForDeployment();

    // Configure a VM like in our core contract: tOpen < tClose, betaOpen >= 1.0, tradable, nOutcomes=2
    const now = await time.latest();
    const tOpen = now + 100;
    const tClose = now + 1000;
    const betaOpen = ethers.parseUnits("1.5", 18); // 1.5 in 18-dec fixed point

    // vmId must have last 5 bytes = 0 shift by 40 bits
    const vmId = 1n << 40n;

    await wp.setVmConfig(vmId, tOpen, tClose, betaOpen, true, 2);

    // 3) Títulos de outcomes (Madrid = 0, Barça = 1)
    await wp.setVmOutcomeTitles(vmId, ["Madrid", "Barça"]);

    // Alice commits right at tOpen (higher beta, more WP per share)
    await time.increaseTo(tOpen);
    await wp.connect(alice).mintCommit(alice.address, vmId, 1, 100n);
    const tAlice = await time.latest(); // timestamp real del último bloque minado (el timeslot que usó el contrato)
    const tokenIdAlice = await wp.vmOutcomeTimeslotIdOf(vmId, 1, tAlice);

    // Bob commits later (beta is lower now, less WP per share). We pick the middle of the window
    const tMid = tOpen + Math.floor((tClose - tOpen) / 2); // random computation for this particular case
    await time.increaseTo(tMid);
    await wp.connect(bob).mintCommit(bob.address, vmId, 1, 90n);
    const tBob = await time.latest();
    const tokenIdBob = await wp.vmOutcomeTimeslotIdOf(vmId, 1, tBob);

    // Compute WP (winning power) for each listing:
    // WP = amount * beta(t) / 1e18, since beta is 18-dec fixed point on-chain.
    const betaAlice = await wp.betaOf(vmId, tOpen);
    const betaBob = await wp.betaOf(vmId, tMid);

    const wpAlice = (100n * BigInt(betaAlice)) / 10n ** 18n;
    const wpBob = (90n * BigInt(betaBob)) / 10n ** 18n;

    // Two asks (in USDC with 6 decimals). We only need them to compare the ratio USDC/WP.
    const askAlice = 10_000_000n; // 10.000000 USDC
    const askBob = 11_000_000n;   // 11.000000 USDC

    const pAlice = pricePerWP(askAlice, wpAlice);
    const pBob = pricePerWP(askBob, wpBob);

    // Just sanity: one must be strictly cheaper than the other for this PoC
    expect(pAlice === pBob).to.equal(false);

    // Manual fill: buyer picks the cheapest listing and seller transfers the ERC-1155 to buyer
    if (pAlice < pBob) {
      expect(await wp.balanceOf(alice.address, tokenIdAlice)).to.equal(100n);
      await wp.connect(alice).safeTransferFrom(alice.address, carol.address, tokenIdAlice, 100n, "0x");
      const balCarol = await wp.balanceOf(carol.address, tokenIdAlice);
      expect(balCarol).to.equal(100n);
    } else {
      await wp.connect(bob).safeTransferFrom(bob.address, carol.address, tokenIdBob, 90n, "0x");
      const balCarol = await wp.balanceOf(carol.address, tokenIdBob);
      expect(balCarol).to.equal(90n);
    }
  });
});
