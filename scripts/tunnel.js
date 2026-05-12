const localtunnel = require('localtunnel');
const fs = require('fs');

(async () => {
  console.log('Starting tunnel...');
  const tunnel = await localtunnel({ port: 3000 });
  console.log('TUNNEL_URL=' + tunnel.url);
  fs.writeFileSync('tunnel_url.txt', tunnel.url);
  console.log('URL saved to tunnel_url.txt');
  tunnel.on('close', () => console.log('Tunnel closed'));
  tunnel.on('error', err => console.error('Tunnel error:', err.message));
  // Keep alive
  setInterval(() => {}, 60000);
})().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
