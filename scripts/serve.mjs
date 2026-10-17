import http from 'node:http';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
let host = '127.0.0.1';
let port = 8787;
while (args.length) {
  const option = args.shift();
  if (option === '--host' && args.length) host = args.shift();
  else if (option === '--port' && args.length) port = Number(args.shift());
  else throw new Error('用法：npm run serve -- [--host 0.0.0.0] [--port 8787]');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须在 1–65535 之间');
const files = new Map([
  ['/LoonSpeedtest.plugin', ['LoonSpeedtest.plugin', 'text/plain; charset=utf-8']],
  ['/loon-speedtest.js', ['loon-speedtest.js', 'application/javascript; charset=utf-8']],
  ['/icon.png', ['icon.png', 'image/png']]
]);
const server = http.createServer(async (req, res) => {
  const entry = files.get((req.url || '').split('?')[0]);
  if (!entry || req.method !== 'GET') { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(new URL('../dist/' + entry[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(503).end('Run npm run build first');
  }
});
server.on('error', error => { console.error('安装文件服务启动失败：' + error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`仅提供插件、脚本和图标：http://${host}:${port}/LoonSpeedtest.plugin\n手机请使用 Mac 的局域网 IP；按 Ctrl-C 停止。`));
