// A small demo that:
// 1) Deploys WPERC1155 + MockUSDC
// 2) Creates a VM with 2 outcomes and titles
// 3) Mints positions (at differents timeslots) so their β differ
// 4) Builds "listings: "X winning power for Y USDC"
// 5) Sorts by cheapest USDC per WP and (optionally) buys one by index (buyIndex=N)

const listingsConfig = require("../data/listings.config");

const { ethers, network } = require("hardhat");

function toNum(x) {
  if (typeof x === "bigint") return x.toString();
  return x.toString();
}

async function main() {
  const [deployer, alice, bob, ruben, albert, carol] = await ethers.getSigners();

  const aliasByAddr = {
  [deployer.address.toLowerCase()]: "Deployer",
  [alice.address.toLowerCase()]: "Alice",
  [bob.address.toLowerCase()]: "Bob",
  [ruben.address.toLowerCase()]: "Ruben",
  [albert.address.toLowerCase()]: "Albert",
  [carol.address.toLowerCase()]: "Carol",
};

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Alice   : ${alice.address}`);
  console.log(`Bob     : ${bob.address}`);
  console.log(`Ruben     : ${ruben.address}`);
  console.log(`Albert   : ${albert.address}`);
  console.log(`Carol   : ${carol.address}`);

  // --- Deploy contracts ---
  const WP = await ethers.getContractFactory("WPERC1155");
  const wp = await WP.deploy(); // the URI isn't used in this PoC; it's fine
  await wp.waitForDeployment();
  console.log(`WPERC1155 at ${await wp.getAddress()}`);

  const USDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await USDC.deploy();
  await usdc.waitForDeployment();
  console.log(`MockUSDC at ${await usdc.getAddress()} (6 decimals)`);

  // Seed buyer with USDC so she can pay
  // 1,000,000 USDC -> 1_000_000 * 1e6
  await (await usdc.transfer(carol.address, 1_000_000n * 1_000_000n)).wait();

  // --- VM config ---
  // vmId must have low 5 bytes zero. E.g. 1 << 40
  const vmId = 1n << 40n;

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const tOpen  = BigInt(now + 10);   // opens in ~10s
  const tClose = tOpen + 600n;       // closes ~10min later

  // betaOpen = 2.0 (scaled 1e18) -> 2_000000000000000000n
  await (await wp.setVmConfig(vmId, tOpen, tClose, 2_000_000_000_000_000_000n, true, 2)).wait();

  // Set outcome titles for realism (index 0 and 1)
  await (await wp.setVmOutcomeTitles(vmId, ["Madrid", "Barça"])).wait();

  // --- Mint commits desde config y construir listings ---
  // Mapeo de alias -> signer
  const signersByAlias = {deployer,alice,bob,ruben, albert, carol,};

  // Definimos tMid, tLater y tQuarter para las etiquetas del config
  const tMid   = tOpen + (tClose - tOpen) / 2n;
  const tLater = tOpen + (tClose - tOpen) * 3n / 4n;
  const tQuarter = tOpen + (tClose - tOpen) / 4n;

  const timeByLabel = {tOpen,tMid,tLater,tQuarter,};

   function pricePerWP_1e18(askUSDC_6dec, wpUnits) {
    // Scale USDC(6) up to 1e18 so we can keep 18-dec math: (USDC_6 * 1e18) / WP_units
    return (askUSDC_6dec * 1_000_000_000_000_000_000n) / BigInt(wpUnits);
  }

  const listings = [];

  async function mineAtOrAfter(target) {
  const latest = (await ethers.provider.getBlock("latest")).timestamp;
  const next = Number(target > BigInt(latest) ? target : BigInt(latest) + 1n);
  await network.provider.send("evm_setNextBlockTimestamp", [next]);
}


  for (const intent of listingsConfig) {
    const sellerSigner = signersByAlias[intent.seller];
    if (!sellerSigner) {
      throw new Error(`Unknown seller alias: ${intent.seller}`);
    }

    let tLabel = timeByLabel[intent.at];
    if (tLabel === undefined && typeof intent.atOffsetSec === 'number') {
    tLabel = tOpen + BigInt(intent.atOffsetSec);
    }
    if (tLabel === undefined) {
    throw new Error(`Unknown time label: ${intent.at}`);
    }

    // fijamos timestamp del próximo bloque para controlar la β
    await mineAtOrAfter(tLabel);
    const tx = await wp.mintCommit(sellerSigner.address, vmId, intent.outcomeIndex, intent.amount);
    const receipt = await tx.wait();
    const minedTs = BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);

    // tokenId con el timeslot REAL del bloque donde se minteó
    const tokenId = await wp.vmOutcomeTimeslotIdOf(vmId, intent.outcomeIndex, minedTs);

    // --- Compute each listing's "winning power" (WP) on-chain ---
    // Note: WP = amount * β / 1e18 (β has 18 decimals)
    const wpUnits = await wp.wpOfTokenId(tokenId, intent.amount);

    listings.push({
      seller: sellerSigner.address,
      tokenId,
      sellAmount: intent.amount,
      wpUnits: wpUnits,
      askUSDC_6dec: intent.askUSDC_6dec,
    });
  }

  // Construir orderbook ordenado por USDC/WP (ascendente)
  const book = listings
    .map(l => ({
      ...l,
      pperWP_1e18: pricePerWP_1e18(l.askUSDC_6dec, l.wpUnits),
    }))
    .sort((a, b) => (a.pperWP_1e18 < b.pperWP_1e18 ? -1 : 1));

  console.log("\n--- ORDERBOOK (cheapest USDC per WP first) ---");
  for (const l of book) {
    // Pretty print: pperWP_1e18 is "USDC atoms (6d) per WP" scaled by 1e18
    const humanPperWP = ethers.formatUnits(l.pperWP_1e18, 24); // string
     const alias = aliasByAddr[l.seller.toLowerCase()] ?? "Unknown";
    console.log(
      `seller=${alias} (${l.seller.slice(0,6)}…) tokenId=${toNum(l.tokenId)} amount=${toNum(l.sellAmount)} ` +
      `WP=${toNum(l.wpUnits)} askUSDC=${Number(l.askUSDC_6dec)/1e6} p/WP≈${Number(humanPperWP).toFixed(6)} USDC`);}

   // If no BUY_INDEX env var, we stop here (list-only phase)
  const BUY_INDEX = process.env.BUY_INDEX;
  if (BUY_INDEX === undefined) {
    console.log("\nListing only. To simulate a buy, run with:");
    console.log("  BUY_INDEX=0 npx hardhat run scripts/wp-orderbook-demo.js");
    console.log("\nPerfecto! ✅");
    return;
  }

  // Pick by index from env var
  const idx = Number(BUY_INDEX);
  if (!Number.isInteger(idx) || idx < 0 || idx >= book.length) {
    console.log("Invalid BUY_INDEX.");
    process.exit(1);
  }

  const chosen = book[idx];
  const humanPperWP = ethers.formatUnits(chosen.pperWP_1e18, 24); // string
  console.log(`\nBuying index #${idx} from ${chosen.seller.slice(0,6)}… at ~${Number(humanPperWP).toFixed(6)} USDC/WP`);


  // --- Buy flow (manual selection) ---

  // Carol pays USDC to the seller
  await (await usdc.connect(carol).transfer(chosen.seller, chosen.askUSDC_6dec)).wait();

  // Seller transfers the ERC-1155 to Carol
 const ierc1155 = new ethers.Interface([
  "function balanceOf(address a, uint256 id) view returns (uint256)"
 ]);
  const wpAsIface = new ethers.Contract(await wp.getAddress(), ierc1155, ethers.provider);

  const sellerSigner = Object.values(signersByAlias).find(s => s.address.toLowerCase() === chosen.seller.toLowerCase());
  const alias = aliasByAddr[sellerSigner.address.toLowerCase()] ?? "Unknown";

  const sellerBal = await wpAsIface.balanceOf(sellerSigner.address, chosen.tokenId);
  console.log(`${alias} (Seller) balance for tokenId ${chosen.tokenId}: ${sellerBal} (wants to sell ${chosen.sellAmount})`);

  if (sellerBal < chosen.sellAmount) {
  throw new Error(`Listing exceeds seller balance: ${sellerBal} < ${chosen.sellAmount}`);
  }

  await (await wp.connect(sellerSigner).safeTransferFrom(
    sellerSigner.address,
    carol.address,
    chosen.tokenId,
    chosen.sellAmount,
    "0x"
  )).wait();

  // --- Print balances to prove it works ---
  const sellerBalAfter = await wpAsIface.balanceOf(sellerSigner.address, chosen.tokenId);
  const carolBalAfter  = await wpAsIface.balanceOf(carol.address, chosen.tokenId);

  console.log(`\n--- ERC-1155 balances after trade (tokenId ${chosen.tokenId}) ---`);
  console.log(`${alias} (Seller): ${sellerBalAfter.toString()}`);
  console.log(`Carol : ${carolBalAfter.toString()}`);

  // USDC balances
  const usdcBalSeller = await usdc.balanceOf(sellerSigner.address);
  const usdcBalCarol  = await usdc.balanceOf(carol.address);

  console.log("\n--- USDC balances (6 decimals) ---");
  console.log(`${alias} (Seller) ${Number(usdcBalSeller)/1e6} USDC`);
  console.log(`Carol : ${Number(usdcBalCarol)/1e6} USDC`);

  console.log("\nPerfecto ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

