// scripts/buyer-fulfill.js
// Loads signed orders, sorts by cheapest USDC/WP, shows them, and fulfills one.
// BUY_INDEX env-var to pick which one: BUY_INDEX=0 npx hardhat run --network sepolia scripts/buyer-fulfill.js

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { initSeaport } = require("./utils/seaport");
// Use WP helpers to compute WP and pricePerWP when order comes from matcher
const { getWpForToken, pricePerWP_1e6 } = require("./utils/wp");


// --- BEGIN: accept --orderJsonPath for PoC automation ---
// --- BEGIN: accept --orderJsonPath / --orderjsonpath for PoC automation ---
let ORDER_FROM_JSON = null;
try {
  const args = require('minimist')(process.argv.slice(2));
  const orderPath = args.orderJsonPath || args.orderjsonpath; // <-- alias en minúsculas
  if (orderPath) {
    const p = path.join(__dirname, '..', orderPath);
    const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Expect: { order: <seaportSignedOrder>, buyer: <address> }
    ORDER_FROM_JSON = payload;
    //console.log('📦 Loaded order from JSON path:', orderPath);
  }
} catch (e) {
  console.warn('Could not parse orderJsonPath:', e.message);
}
// --- END ---

const USDC_ADDR     = process.env.USDC_ADDR;
const SEAPORT_ADDR  = process.env.SEPOLIA_SEAPORT || process.env.SEAPORT_ADDR; // the one we have in .env
const FUND_FROM_PK  = process.env.FUND_FROM_PK; // optional: account with USDC to fund the buyer

function loadOrders() {
  const p = path.join(__dirname, "..", "data", "orders.sepolia.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// convert 6-decimal integer to human-readable number
function humanUSDC(ask6) {
  return Number(BigInt(ask6)) / 1e6;
}

// format pricePerWP_1e6 to human-readable
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

  const topUp = minNeeded_6 - bal; // transfer exactly what is missing
  const tx = await usdcAsFunder.transfer(buyer.address, topUp);
  await tx.wait();
  const newBal = await usdcAsBuyer.balanceOf(buyer.address);
  console.log(`Funded buyer with USDC. New balance: ${Number(newBal)/1e6} USDC`);
}

async function main() {
  if (!USDC_ADDR || !SEAPORT_ADDR || !process.env.WP_ADDR) {
    throw new Error("Faltan env: USDC_ADDR y/o SEAPORT_ADDR y/o WP_ADDR.");
  }

  const buyer = new ethers.Wallet(process.env.BUYER_PK, ethers.provider);
  const { seaport } = await initSeaport(buyer);

 // --- BEGIN: fast-path when matcher passes an order via --orderJsonPath ---
let chosen; // we'll set this either from ORDER_FROM_JSON or from the orderbook path

if (ORDER_FROM_JSON) {
  // Build "chosen" from the raw Seaport order provided by the matcher
  const order = ORDER_FROM_JSON.order;
  const p = order.parameters;
  const off0 = p.offer?.[0];
  const con0 = p.consideration?.[0];

  // Use the WP contract address from the seller's order, not from env
const wpAddrFromOrder = off0.token;

  if (!off0 || !con0) throw new Error("Malformed order from matcher.");

  const tokenId = off0.identifierOrCriteria.toString();
  const amount  = Number(off0.startAmount);
  const ask6    = con0.startAmount.toString();
  const seller  = p.offerer;

  // Compute WP and p/WP (1e6 scale) to populate meta
  const { wp1e6 } = await getWpForToken(wpAddrFromOrder, tokenId, amount);
  const pperWP_1e6 = pricePerWP_1e6(ask6, wp1e6);

  chosen = {
    meta: {
      seller,
      tokenId,
      amount,
      askUSDC_6dec: ask6,
      wp_units_1e6: wp1e6.toString(),
      pricePerWP_1e6: pperWP_1e6.toString(),
      human: {
        askUSDC: humanUSDC(ask6),
        pricePerWP: humanPricePerWP(pperWP_1e6),
      }
    },
    order
  };

  // From here on, the script continues using "chosen" as usual.
}
// --- END: fast-path when matcher passes an order via --orderJsonPath ---
  if (!ORDER_FROM_JSON) {
  // Load and sort by ratio (cheapest first)
  const orders = loadOrders();
  if (!orders.length) {
    console.log("No orders found in data/orders.sepolia.json");
    return;
  }

  // Ensure that meta.pricePerWP_1e6 exists (new format)
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
   const wpHuman = o.meta.wp_units_1e6
  ? (Number(o.meta.wp_units_1e6) / 1e6).toFixed(6)
  : o.meta.wp_units;
    console.log(
  `#${o._idx} seller=${o.meta.seller.slice(0,6)}… tokenId=${o.meta.tokenId} ` +
  `amount=${o.meta.amount} WP=${wpHuman} askUSDC=${o.meta.human.askUSDC} ` +
  `p/WP≈${o.meta.human.pricePerWP.toFixed(6)}`
);
  });

  // Choose index by env
  const BUY_INDEX = process.env.BUY_INDEX;
  if (BUY_INDEX === undefined) {
    console.log("\nListing only. Set BUY_INDEX env var to fulfill one:");
    console.log("  BUY_INDEX=0 npx hardhat run --network sepolia scripts/buyer-fulfill.js");
    return;
  }
  const idx = Number(BUY_INDEX);
  chosen = book.find(o => o._idx === idx); // ← sin const, asigna al externo
 } 
  if (!chosen) {
    console.log("No chosen order (either no BUY_INDEX or no matcher order).");
    process.exit(1);
  }

  // PRECHECK ORDER SHAPE. Validate that the order buyer is about to buy fits our policy and our target (contract, tokenId, amount, USDC)
  const p = chosen.order.parameters;
  const off0 = p.offer?.[0];
  const con0 = p.consideration?.[0];
  if (!off0 || !con0) throw new Error("Malformed order (missing offer/consideration)");

  if (off0.itemType !== 3 || off0.token.toLowerCase() !== process.env.WP_ADDR.toLowerCase()) {
  throw new Error("Offer must be ERC1155 from our WP contract");
  }
  if (off0.identifierOrCriteria !== chosen.meta.tokenId) {
  throw new Error("Offer tokenId mismatch with metadata");
  }
  if (BigInt(off0.startAmount) !== BigInt(chosen.meta.amount) ||
    BigInt(off0.endAmount)   !== BigInt(chosen.meta.amount)) {
  throw new Error("Offer amount mismatch with metadata");
  }

  if (con0.itemType !== 1 || con0.token.toLowerCase() !== USDC_ADDR.toLowerCase()) {
  throw new Error("Consideration must be USDC (ERC20)");
  }
  if (BigInt(con0.startAmount) !== BigInt(chosen.meta.askUSDC_6dec) ||
    BigInt(con0.endAmount)   !== BigInt(chosen.meta.askUSDC_6dec)) {
  throw new Error("Consideration amount mismatch (USDC)");
}

  // Fund buyer if they don't have enough USDC
  const ask6 = BigInt(chosen.meta.askUSDC_6dec);

  // PRICE GUARD. Protect the buyer: We don’t execute if the USDC/WP goes above the price limit set in env (optional)
  if (process.env.MAX_PRICE_PER_WP_1e6) {
  const maxP = BigInt(process.env.MAX_PRICE_PER_WP_1e6);
  const pperWP = BigInt(chosen.meta.pricePerWP_1e6);
  if (pperWP > maxP) {
    throw new Error(`PricePerWP ${pperWP} > max ${maxP} (abort)`);
  }
  }

  await ensureBuyerHasUSDC(buyer, ask6);

  // LIVE CHECKS SELLER: balance and approval. Make sure the seller still has enough balance and has not revoked Seaport approval (setApprovalForAll)
 const i1155View = new ethers.Interface([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function isApprovedForAll(address account, address operator) view returns (bool)"
 ]);
 const wpRead = new ethers.Contract(process.env.WP_ADDR, i1155View, buyer.provider);

const balSellerNow = await wpRead.balanceOf(chosen.meta.seller, chosen.meta.tokenId);
if (balSellerNow < BigInt(chosen.meta.amount)) {
  throw new Error("Seller no longer owns enough balance for this tokenId");
}
const approved = await wpRead.isApprovedForAll(chosen.meta.seller, SEAPORT_ADDR);
if (!approved) throw new Error("Seller revoked approval to Seaport (cannot fulfill)");

  // Buyer approval → Seaport (no conduit, using conduitKey=0x0)
  const erc20 = new ethers.Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner,address spender) view returns (uint256)"
  ]);
  const usdc = new ethers.Contract(USDC_ADDR, erc20, buyer);

  // If allowance is already enough, we don’t re-approve
  const allowance = await usdc.allowance(buyer.address, SEAPORT_ADDR);
  if (allowance < ask6) {
    const txA = await usdc.approve(SEAPORT_ADDR, ethers.MaxUint256);
    await txA.wait();
    console.log(`approve(USDC -> Seaport ${SEAPORT_ADDR}) ✅`);
  } else {
    console.log(`approve skipped (allowance already sufficient) ✅`);
  }

  // Fulfill
  const wpHumanChosen = chosen.meta.wp_units_1e6
  ? (Number(chosen.meta.wp_units_1e6) / 1e6).toFixed(6)
  : chosen.meta.wp_units;

  const idxLabel = ORDER_FROM_JSON ? 'matcher' : idx;
  console.log(
  `\nFulfilling order #${idxLabel} (WP=${wpHumanChosen}, ` +
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

  // Show balances after fulfill
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

