// scripts/utils/seaport.js
const { Seaport } = require("@opensea/seaport-js");
const { ItemType } = require("@opensea/seaport-js/lib/constants");

async function initSeaport(signer) {
  const seaport = new Seaport(signer); // autodetecta Seaport en Sepolia
  return { seaport, ItemType };
}

module.exports = { initSeaport };
