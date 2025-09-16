// scripts/buyer-fulfill.js
// Loads signed orders, sorts by cheapest USDC/WP, shows them, and fulfills one.
// BUY_INDEX env-var to pick which one: BUY_INDEX=0 npx hardhat run --network sepolia scripts/buyer-fulfill.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { initSeaport } = require("./utils/seaport");

const USDC_ADDR     = process.env.USDC_ADDR;
const SEAPORT_ADDR  = process.env.SEPOLIA_SEAPORT || process.env.SEAPORT_ADDR; // el que tengas en .env
const FUND_FROM_PK  = process.env.FUND_FROM_PK; // opcional: cuenta con USDC para fondear al buyer

function loadOrders() {
  const p = path.join(__dirname, "..", "data", "orders.sepolia.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// helper: convierte entero 6 dec a número humano
function humanUSDC(ask6) {
  return Number(BigInt(ask6)) / 1e6;
}
// helper: formatea pricePerWP_1e6 a humano
function humanPricePerWP(pperWP_1e6) {
  return Number(ethers.formatUnits(pperWP_1e6.toString(), 6));
}

async function ensureBuyerHasUSDC(buyer, minNeeded_6) {
  const erc20 = new ethers.Interface([
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)"
  ]);
  const usdcAsBuyer = new ethers.Contract(USDC_ADDR, erc20, buyer);
  const bal = await usdcAsBuyer.balanceOf(buyer.address);
  if (bal >= minNeeded_6) return; // suficiente

  if (!FUND_FROM_PK) {
    console.log(`\n⚠️  Buyer no tiene USDC suficiente (${Number(bal)/1e6}). Añade fondos o define FUND_FROM_PK en .env.\n`);
    return;
  }
  const funder = new ethers.Wallet(FUND_FROM_PK, ethers.provider);
  const usdcAsFunder = new ethers.Contract(USDC_ADDR, erc20, funder);

  const topUp = minNeeded_6 - bal; // transfiere justo lo que falta
  const tx = await usdcAsFunder.transfer(buyer.address, topUp);
  await tx.wait();
  const newBal = await usdcAsBuyer.balanceOf(buyer.address);
  console.log(`Funded buyer with USDC. New balance: ${Number(newBal)/1e6} USDC`);
}

async function main() {
  if (!USDC_ADDR || !SEAPORT_ADDR) {
    throw new Error("Faltan env: USDC_ADDR y/o SEAPORT_ADDR (o SEPOLIA_SEAPORT).");
  }

  const buyer = new ethers.Wallet(process.env.BUYER_PK, ethers.provider);
  const { seaport } = await initSeaport(buyer);

  // 1) Cargar y ordenar por ratio (más barato primero)
  const orders = loadOrders();
  if (!orders.length) {
    console.log("No orders found in data/orders.sepolia.json");
    return;
  }

  // Aseguramos que existe meta.pricePerWP_1e6 (formato nuevo)
  const book = orders
    .map((o, i) => ({ ...o, _idx: i }))
    .sort((a, b) => {
      const ax = BigInt(a.meta.pricePerWP_1e6);
      const bx = BigInt(b.meta.pricePerWP_1e6);
      if (ax < bx) return -1;
      if (ax > bx) return 1;
      return 0;
    });

  console.log("\n--- ORDERBOOK (cheapest USDC per WP first) ---");
  book.forEach(o => {
    console.log(
  `#${o._idx} seller=${o.meta.seller.slice(0,6)}… tokenId=${o.meta.tokenId} ` +
  `amount=${o.meta.amount} WP=${o.meta.wp_units} askUSDC=${o.meta.human.askUSDC} ` +
  `p/WP≈${o.meta.human.pricePerWP.toFixed(6)}`
);
  });

  // 2) Elegir índice por env
  const BUY_INDEX = process.env.BUY_INDEX;
  if (BUY_INDEX === undefined) {
    console.log("\nListing only. Set BUY_INDEX env var to fulfill one:");
    console.log("  BUY_INDEX=0 npx hardhat run --network sepolia scripts/buyer-fulfill.js");
    return;
  }
  const idx = Number(BUY_INDEX);
  const chosen = book.find(o => o._idx === idx);
  if (!chosen) {
    console.log("Invalid BUY_INDEX.");
    process.exit(1);
  }

  // 3) (Opcional) Fondear buyer si no tiene USDC suficiente
  const ask6 = BigInt(chosen.meta.askUSDC_6dec);
  await ensureBuyerHasUSDC(buyer, ask6);

  // 4) Approval del buyer → Seaport (sin conduit; usamos conduitKey=0x0)
  const erc20 = new ethers.Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner,address spender) view returns (uint256)"
  ]);
  const usdc = new ethers.Contract(USDC_ADDR, erc20, buyer);

  // Si ya hay allowance suficiente, no reaprobamos.
  const allowance = await usdc.allowance(buyer.address, SEAPORT_ADDR);
  if (allowance < ask6) {
    const txA = await usdc.approve(SEAPORT_ADDR, ethers.MaxUint256);
    await txA.wait();
    console.log(`approve(USDC -> Seaport ${SEAPORT_ADDR}) ✅`);
  } else {
    console.log(`approve skipped (allowance already sufficient) ✅`);
  }

  // 5) Fulfill
console.log(
  `\nFulfilling order #${idx} (WP=${chosen.meta.wp_units}, ` +
  `p/WP≈${chosen.meta.human.pricePerWP.toFixed(6)}) …`
);
  const { executeAllActions: fulfill } = await seaport.fulfillOrder({
    order: chosen.order,
    accountAddress: buyer.address,
  });

  const tx = await fulfill();
  console.log("Tx sent:", tx.hash);
  const rc = await tx.wait();
  console.log("Fulfilled ✅ Block:", rc.blockNumber);

  // --- Show balances after fulfill ---
  const wpAbi = [
    "function balanceOf(address account, uint256 id) view returns (uint256)"
  ];
  const wp = new ethers.Contract(process.env.WP_ADDR, wpAbi, buyer.provider);

  const balSeller = await wp.balanceOf(chosen.meta.seller, chosen.meta.tokenId);
  const balBuyer  = await wp.balanceOf(buyer.address, chosen.meta.tokenId);

  console.log("\n--- ERC-1155 balances after trade ---");
  console.log(`Seller=${chosen.meta.seller.slice(0,6)}… tokenId=${chosen.meta.tokenId} Balance=${balSeller}`);
  console.log(`Buyer =${buyer.address.slice(0,6)}… tokenId=${chosen.meta.tokenId} Balance=${balBuyer}`);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

