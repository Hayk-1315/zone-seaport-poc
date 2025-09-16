// scripts/preview-ratios.js
// Lee data/listings.config.js, calcula Winning Power (WP) on-chain para cada entrada,
// y muestra el ratio USDC/WP ordenado (así ajustas askUSDC_6dec con cabeza).

const { ethers } = require("hardhat");
const path = require("path");

async function main() {
  const WP_ADDR = process.env.WP_ADDR;
  const USDC_ADDR = process.env.USDC_ADDR; // no lo usamos aquí, pero lo dejo por coherencia .env
  if (!WP_ADDR) throw new Error("Missing WP_ADDR in .env");

  // Carga del config generado por sepolia-scan-holdings.js (y luego editado por ti)
  const listings = require(path.join(__dirname, "../data/listings.config.js"));
  if (!Array.isArray(listings) || listings.length === 0) {
    throw new Error("data/listings.config.js vacío o mal formado");
  }

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

  // ABI mínimo del WP para calcular WP = amount * beta / 1e18
  const wpAbi = [
    "function wpOfTokenId(uint256 tokenId, uint256 amount) view returns (uint256)",
  ];
  const wp = new ethers.Contract(WP_ADDR, wpAbi, provider);

  // helper: USDC(6) per WP con precisión 1e18 (para luego formatear bonito)
  function pricePerWP_1e18(askUSDC_6dec, wp_e18) {
    // (askUSDC_6dec * 1e18) / wp_e18  -> queda en “USDC con 6d”, pero escalado a 1e18
    const ask = BigInt(askUSDC_6dec);
    const wp = BigInt(wp_e18);
    return (ask * 1_000_000_000_000_000_000n) / wp;
  }

  const rows = [];
  for (let i = 0; i < listings.length; i++) {
    const { tokenId, amount, askUSDC_6dec } = listings[i];

    // 1) calculamos WP on-chain
    const wp_e18 = await wp.wpOfTokenId(tokenId, amount);

    // 2) ratio (USDC/WP)
    const pperWP_1e18 = pricePerWP_1e18(askUSDC_6dec, wp_e18);

    // 3) formateo humano: ethers.formatUnits( … , 24 ) → (6+18) decimales
    const ratioHuman = Number(ethers.formatUnits(pperWP_1e18, 24)); // string → number

    rows.push({
      idx: i,
      tokenId: tokenId.toString(),
      amount: amount.toString(),
      wp: wp_e18.toString(),
      askUSDC: Number(askUSDC_6dec) / 1e6,  // 6 decimales
      ratioUSDCperWP: ratioHuman,           // USDC por 1 WP
    });
  }

  // ordenar por ratio ascendente (más barato primero)
  rows.sort((a, b) => a.ratioUSDCperWP - b.ratioUSDCperWP);

  console.log("\n--- PREVIEW (cheapest USDC per WP first) ---");
  for (const r of rows) {
    console.log(
      `#${r.idx} tokenId=${r.tokenId} amount=${r.amount} ` +
      `WP=${r.wp} askUSDC=${r.askUSDC} p/WP≈${r.ratioUSDCperWP.toFixed(6)} USDC`
    );
  }

  console.log(
    "\nTip: ajusta askUSDC_6dec en data/listings.config.js hasta que los ratios queden como quieres.\n" +
    "Luego firma con seller-list.js y el buyer podrá elegir el más barato con BUY_INDEX.\n"
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
