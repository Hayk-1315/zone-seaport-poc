// scripts/utils/wp.js
const { ethers } = require("hardhat");

/**
 * getWpForToken
 * - wpOfTokenId(tokenId, amount) ya devuelve WP ENTERO (tras /1e18).
 * - Devolvemos:
 *    - wpInt : entero (compat con tus scripts).
 *    - wp1e6 : WP con 6 decimales (usando beta antes de truncar).
 */
async function getWpForToken(WP_ADDR, tokenId, amount) {
  const abi = [
    "function wpOfTokenId(uint256 tokenId, uint256 amount) view returns (uint256)",
    "function betaOf(uint256 vmId, uint256 t) view returns (uint256)",
    "function destructure(uint256 tokenId) pure returns (uint256 vmId, uint8 outcomeIndex, uint32 timeslot)"
  ];
  const c = new ethers.Contract(WP_ADDR, abi, ethers.provider);

  // 1) WP entero (ya truncado en el contrato por /1e18)
  const wpRaw = await c.wpOfTokenId(tokenId, amount);
  const wpInt = BigInt(wpRaw.toString());

  // 2) Precisión para ratios: wp1e6 = floor(amount * beta / 1e12)
  const [vmId, , timeslot] = await c.destructure(tokenId);
  const betaRaw = await c.betaOf(vmId, timeslot);      // beta en 1e18
  const betaE18 = BigInt(betaRaw.toString());
  const amt = BigInt(amount);
  const wp1e6 = (amt * betaE18) / 1_000_000_000_000n;  // divide por 1e12

  return { wpInt, wp1e6 };
}

/**
 * pricePerWP_1e6
 * - Precio por WP con escala 1e6.
 * - Fórmula: p_1e6 = (askUSDC_6dec * 1e6) / WP_1e6
 */
function pricePerWP_1e6(askUSDC_6dec, wp_1e6) {
  const ask = BigInt(askUSDC_6dec); // USDC en 6 decimales
  const wp  = BigInt(wp_1e6);       // WP en 6 decimales
  if (wp === 0n) throw new Error("WP is zero");
  return (ask * 1_000_000n) / wp;   // entero con escala 1e6
}

function humanUSDC(ask6) {
  return Number(BigInt(ask6)) / 1e6;
}
function humanPricePerWP(pperWP_1e6) {
  return Number(ethers.formatUnits(pperWP_1e6.toString(), 6));
}

module.exports = {
  getWpForToken,
  pricePerWP_1e6,
  humanUSDC,
  humanPricePerWP,
};


