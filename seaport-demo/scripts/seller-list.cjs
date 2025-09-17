// scripts/seller-list.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { initSeaport } = require("./utils/seaport.js");
const { pricePerWP_1e6, getWpForToken, humanUSDC, humanPricePerWP } = require("./utils/wp.js");
const listingsConfig = require("../data/listings.config.js");

const WP_ADDR         = process.env.WP_ADDR;
const USDC_ADDR       = process.env.USDC_ADDR;
const SEAPORT_ADDRESS = process.env.SEAPORT_ADDR; 

// convierte "10", "10.0", "4.500000", "10000000" a entero 6 decimales (BigInt)
function parseUSDC6(x) {
  if (typeof x === "bigint") return x;
  const s = String(x);
  if (!s.includes(".")) return BigInt(s);           // ya es entero 6d (o sin decimales)
  const [i, dRaw] = s.split(".");
  const d = (dRaw + "000000").slice(0, 6);          // pad / recorta a 6
  return BigInt(i + d);
}

async function main() {
  if (!WP_ADDR || !USDC_ADDR || !SEAPORT_ADDRESS) {
    throw new Error("Faltan env: WP_ADDR, USDC_ADDR, SEAPORT_ADDR");
  }

  const seller = new ethers.Wallet(process.env.SELLER_PK, ethers.provider);
  const { seaport, ItemType } = await initSeaport(seller);

  // Approvals consistent with conduitKey = 0x0 (direct)
  // Direct route => operator = Seaport contract
  const i1155 = new ethers.Interface([
    "function setApprovalForAll(address operator, bool approved)"
  ]);
  const wp = new ethers.Contract(WP_ADDR, i1155, seller);
  const txA = await wp.setApprovalForAll(SEAPORT_ADDRESS, true);
  await txA.wait();
  console.log(`setApprovalForAll(ERC1155 -> ${SEAPORT_ADDRESS}) ✅`);


  const rowsForPreview = []; // optional: to view them sorted by price/WP

  for (const raw of listingsConfig) {
    const tokenId = raw.tokenId?.toString();
    const amount  = raw.amount?.toString();
    if (!tokenId || !amount || raw.askUSDC_6dec == null) continue;

    // normalize USDC 6d
    const ask6 = parseUSDC6(raw.askUSDC_6dec).toString();

    // Metrics (logging only)
    const wpUnits = await getWpForToken(WP_ADDR, tokenId, amount);
    const pperWP      = pricePerWP_1e6(ask6, wpUnits);

     // accumulate to sort and display
    rowsForPreview.push({
    tokenId,
    amount,
    ask6,
    wpUnits: wpUnits.toString(),
    pperWP_1e6: pperWP.toString(),
  });

    const start = Math.floor(Date.now()/1000) - 60;
    const end   = start + 60*60*24;

    const orderParams = {
      offerer: seller.address,
      startTime: start.toString(),
      endTime: end.toString(),
      zone: ethers.ZeroAddress,
      conduitKey: "0x" + "00".repeat(32), // DIRECT (withoutconduit)
      offer: [
        { itemType: ItemType.ERC1155, token: WP_ADDR, identifier: tokenId, amount: amount },
      ],
      consideration: [
        { itemType: ItemType.ERC20, token: USDC_ADDR, identifier: "0", amount: ask6, recipient: seller.address },
      ],
    };

    const { executeAllActions } = await seaport.createOrder(orderParams, seller.address);
    const order = await executeAllActions();

    orders.push({
      meta: {
        seller: seller.address,
        tokenId,
        amount,
        askUSDC_6dec: ask6,
        wp_units: wpUnits.toString(),
        pricePerWP_1e6: pperWP.toString(),
        human: {
          askUSDC: humanUSDC(ask6),
          pricePerWP: humanPricePerWP(pperWP),
        }
      },
      order
    });

    console.log(
      `Signed order: tokenId=${tokenId} amount=${amount} askUSDC=${humanUSDC(ask6)} ` +
      `(p/WP≈${humanPricePerWP(pperWP).toFixed(6)} USDC)`
    );
  }

  // Optional: Show preview ordered, cheapest first
rowsForPreview.sort((a, b) => {
  const ax = BigInt(a.pperWP_1e6);
  const bx = BigInt(b.pperWP_1e6);
  if (ax < bx) return -1;
  if (ax > bx) return 1;
  return 0;
});

console.log("\n--- PREVIEW (cheapest USDC per WP first) ---");
for (const r of rowsForPreview) {
  console.log(
    `tokenId=${r.tokenId} amount=${r.amount} WP=${r.wpUnits} ` +
    `askUSDC=${humanUSDC(r.ask6)} p/WP≈${humanPricePerWP(r.pperWP_1e6).toFixed(6)} USDC`
  );
}

  const out = path.join(__dirname, "..", "data", "orders.sepolia.json");
  fs.writeFileSync(out, JSON.stringify(orders, null, 2));
  console.log(`\nSaved ${orders.length} orders -> ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
