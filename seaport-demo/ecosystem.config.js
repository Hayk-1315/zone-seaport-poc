module.exports = {
  apps: [
    {
      name: 'matcher',
      cwd: 'C:/Users/34642/Desktop/seaport-zone-poc/seaport-demo',
      script: 'node',
      // Carga el runtime de Hardhat antes de tu script (equivale a "hardhat run")
      args: '-r hardhat/register scripts/matcher-run.cjs',
      env: {
        HARDHAT_NETWORK: 'sepolia'
      },
      autorestart: true, // ponemos false para evitar reinicios infinitos
      watch: false,
      time: true,
      merge_logs: true,
      windowsHide: true
    }
  ]
}




