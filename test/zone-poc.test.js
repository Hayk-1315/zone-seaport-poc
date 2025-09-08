const { expect } = require("chai");
const { ethers } = require("hardhat");

// ABI mínima solo si quieres leer balanceOf (en el test de éxito)
const ierc1155 = new ethers.Interface([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

it("rechaza si VM no es tradable", async function () {
  const [_, offerer, buyer, fee1] = await ethers.getSigners();

  const Market = await ethers.getContractFactory("MockERC1155Market");
  const market = await Market.deploy();

  const Zone = await ethers.getContractFactory("ZoneMinimal");
  const zone = await Zone.deploy(await market.getAddress(), [fee1.address]);

  const Seaport = await ethers.getContractFactory("MockSeaport");
  const seaport = await Seaport.deploy();

  const tokenId = 1n;
  const vmId = 2n;

  // Mint pero NO marcamos tradable
  await market.mint(offerer.address, tokenId, 1, vmId);

  const order = {
    offerer: offerer.address,
    token: await market.getAddress(),
    tokenId,
    amount: 1n,
    zone: await zone.getAddress(),
    vmId,
    consideration: [{ recipient: fee1.address, amount: 1n }], // sin helper
  };

  await market
    .connect(offerer)
    .setApprovalForAll(await seaport.getAddress(), true);

  await expect(
    seaport.connect(buyer).fulfillOrder(order, buyer.address)
  ).to.be.revertedWith("VM not tradable");
});

it("rechaza si falta recipient requerido en consideration[]", async function () {
  const [_, offerer, buyer, fee1] = await ethers.getSigners();

  const Market = await ethers.getContractFactory("MockERC1155Market");
  const market = await Market.deploy();

  const Zone = await ethers.getContractFactory("ZoneMinimal");
  const zone = await Zone.deploy(await market.getAddress(), [fee1.address]);

  const Seaport = await ethers.getContractFactory("MockSeaport");
  const seaport = await Seaport.deploy();

  const tokenId = 55n;
  const vmId = 66n;

  await market.mint(offerer.address, tokenId, 5, vmId);
  await market.setTradable(vmId, true);

  const order = {
    offerer: offerer.address,
    token: await market.getAddress(),
    tokenId,
    amount: 1n,
    zone: await zone.getAddress(),
    vmId,
    consideration: [], // falta fee1 => debe revertir
  };

  await market
    .connect(offerer)
    .setApprovalForAll(await seaport.getAddress(), true);

  await expect(
    seaport.connect(buyer).fulfillOrder(order, buyer.address)
  ).to.be.revertedWith("missing required recipient");
});

it("permite la venta cuando todo cuadra", async function () {
  const [deployer, offerer, buyer, fee1] = await ethers.getSigners();

  const Market = await ethers.getContractFactory("MockERC1155Market");
  const market = await Market.deploy();

  const Zone = await ethers.getContractFactory("ZoneMinimal");
  const zone = await Zone.deploy(await market.getAddress(), [fee1.address]);

  const Seaport = await ethers.getContractFactory("MockSeaport");
  const seaport = await Seaport.deploy();

  const tokenId = 12345n;
  const vmId = 777n;

  // Mint al seller y marcamos VM como tradable
  await market.mint(offerer.address, tokenId, 10, vmId);
  await market.setTradable(vmId, true);

  // Approval del seller a Seaport
  await market.connect(offerer).setApprovalForAll(await seaport.getAddress(), true);

  // Orden válida: token correcto, vmId correcto, VM tradable y fee presente
  const order = {
    offerer: offerer.address,
    token: await market.getAddress(),
    tokenId,
    amount: 2n,
    zone: await zone.getAddress(),
    vmId,
    consideration: [{ recipient: fee1.address, amount: 1n }],
  };

  // Fulfills sin revertir
  await expect(seaport.connect(buyer).fulfillOrder(order, buyer.address))
    .to.emit(seaport, "OrderFulfilled")
    .withArgs(offerer.address, await zone.getAddress(), await market.getAddress(), tokenId, 2n);

    // (Opcional) verificar balances
 
  const marketAsIface = new ethers.Contract(await market.getAddress(), ierc1155, ethers.provider);
  const balOfferer = await marketAsIface.balanceOf(offerer.address, tokenId);
  const balBuyer   = await marketAsIface.balanceOf(buyer.address, tokenId);
  expect(balOfferer).to.equal(8n);
  expect(balBuyer).to.equal(2n);
});

