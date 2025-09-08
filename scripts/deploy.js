const hre = require("hardhat");
const { ethers } = hre;


async function main() {
const [deployer, offerer, buyer, fee1] = await ethers.getSigners();


// Deploy contracts
const Market = await ethers.getContractFactory("MockERC1155Market");
const market = await Market.deploy();
const marketAddr = await market.getAddress();


const Zone = await ethers.getContractFactory("ZoneMinimal");
const zone = await Zone.deploy(marketAddr, [fee1.address]);
const zoneAddr = await zone.getAddress();


const Seaport = await ethers.getContractFactory("MockSeaport");
const seaport = await Seaport.deploy();
const seaportAddr = await seaport.getAddress();


console.log("Deployed addresses:", {
market: marketAddr,
zone: zoneAddr,
seaport: seaportAddr,
deployer: deployer.address,
offerer: offerer.address,
buyer: buyer.address,
fee1: fee1.address,
});


// Prepare a token & VM
const tokenId = 12345n;
const vmId = 777n;
const amountOffer = 10n;
const amountSell = 2n;


await (await market.mint(offerer.address, tokenId, amountOffer, vmId)).wait();
await (await market.setTradable(vmId, true)).wait();


// Approval so Seaport can transfer ERC-1155
await (await market.connect(offerer).setApprovalForAll(seaportAddr, true)).wait();


// Build order
const consideration = [{ recipient: fee1.address, amount: 1n }];
const order = {
offerer: offerer.address,
token: marketAddr,
tokenId,
amount: amountSell,
zone: zoneAddr,
vmId,
consideration,
};


console.log("Fulfilling order...");
const tx = await seaport.connect(buyer).fulfillOrder(order, buyer.address);
const rc = await tx.wait();
console.log("fulfillOrder tx hash:", rc && rc.hash);


// Quick balance check via minimal interface
const ierc1155 = new ethers.Interface([
"function balanceOf(address account, uint256 id) view returns (uint256)",
]);
const marketAsIface = new ethers.Contract(marketAddr, ierc1155, ethers.provider);


const balOfferer = await marketAsIface.balanceOf(offerer.address, tokenId);
const balBuyer = await marketAsIface.balanceOf(buyer.address, tokenId);


console.log("Balances after trade:");
console.log(" - offerer:", balOfferer.toString());
console.log(" - buyer :", balBuyer.toString());
}


main().catch((err) => {
console.error(err);
process.exit(1);
});