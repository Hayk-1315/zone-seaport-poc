// scripts/deploy-sepolia.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Deploy WPERC1155
  const WP = await ethers.getContractFactory("WPERC1155");
  const wp = await WP.deploy();
  await wp.waitForDeployment();
  const wpAddress = await wp.getAddress();
  console.log("WPERC1155 deployed at:", wpAddress);

  // Deploy MockUSDC
  const USDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await USDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("MockUSDC deployed at:", usdcAddress);

  ///  Minimal config of a test VM
  // vmId with 5 lower bytes set to 0 (1 << 40):
  const vmId = 1n << 40n;

  // Times:
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const tOpen  = BigInt(now + 60);
  const tClose = tOpen + 735000n; // ~8.5 days


  // betaOpen = 2.0 (escala 1e18)
  const betaOpen_e18 = 2_000_000_000_000_000_000n;
  const tradable = true;
  const nOutcomes = 2;

  
  const tx1 = await wp.setVmConfig(vmId, tOpen, tClose, betaOpen_e18, tradable, nOutcomes);
  await tx1.wait();

 
  try {
    const tx2 = await wp.setVmOutcomeTitles(vmId, ["Home", "Away"]);
    await tx2.wait();
  } catch (e) {
    console.log("setVmOutcomeTitles not available or failed (ok for minimal PoC).");
  }

  // Store addresses to use them later
  const out = {
    network: "sepolia",
    deployer: deployer.address,
    WPERC1155: wpAddress,
    MockUSDC: usdcAddress,
    vm: { vmId: vmId.toString(), tOpen: tOpen.toString(), tClose: tClose.toString() }
  };

  const file = path.join(__dirname, "..", "deployments", "sepolia.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Saved:", file);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
