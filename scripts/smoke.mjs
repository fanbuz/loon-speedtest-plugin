import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import core from '../src/core.js';

// Node smoke verifies the shared algorithm and endpoint only. It cannot use Loon nodes.
const args = process.argv.slice(2);
let local = false;
let source = 'cf';
let testUrl;
let warmup = 2;
let direction = 'both';
while (args.length) {
  const option = args.shift();
  if (option === '--local') local = true;
  else if (option === '--source' && args.length) source = args.shift();
  else if (option === '--test-url' && args.length) testUrl = args.shift();
  else if (option === '--direction' && args.length) direction = args.shift();
  else if (option === '--warmup' && args.length) warmup = args.shift();
  else throw new Error('用法：npm run smoke -- [--local] [--source cf|apple|custom] [--test-url URL] [--warmup 秒] [--direction both|download|upload]');
}
let server;
if (local) {
  server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let received = 0;
      req.on('data', chunk => { received += chunk.length; });
      req.on('end', () => {
        if (received !== Number(req.headers['content-length'])) { res.writeHead(400); res.end(); return; }
        res.writeHead(200, { 'Content-Length': '0' }); res.end();
      });
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': '4294967296' });
      res.end();
      return;
    }
    const range = req.headers.range;
    const size = range ? Number(range.split('-')[1]) + 1 : Number(new URL(req.url, 'http://localhost').searchParams.get('bytes'));
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': size };
    if (range) headers['Content-Range'] = 'bytes 0-' + (size - 1) + '/4294967296';
    res.writeHead(range ? 206 : 200, headers);
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(size));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}
const options = core.normalizeOptions({ node: 'DIRECT', mode: 'compare', maxMB: 4, chunkKB: 250, duration: 3, requestTimeout: 5, test_source: source, test_url: testUrl, warmup, direction });
try {
  const result = await core.run(options, {
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
    log: text => console.log(text),
    request: spec => new Promise((resolve, reject) => {
      const url = local ? `http://127.0.0.1:${server.address().port}/${spec.method === 'POST' ? '__up' : '__down'}?bytes=${spec.bytes}` : spec.url;
      const request = (new URL(url).protocol === 'http:' ? http : https).request(url, {
        method: spec.method || 'GET',
        agent: false, headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache, no-store', ...spec.headers, ...(spec.body ? { 'Content-Length': spec.body.byteLength } : {}) }
      }, response => {
        let bytes = 0;
        const fail = error => { request.destroy(); reject(error); };
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > (spec.method === 'POST' ? 65536 : spec.bytes)) fail(new Error('服务器返回的数据超过请求大小'));
        });
        response.on('error', fail);
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, binary: true, bytes }));
      });
      // Wall-clock deadline; setTimeout() on ClientRequest alone only caps idle time.
      const timer = setTimeout(() => request.destroy(new Error('Node 冒烟请求超时')), spec.timeout);
      request.on('close', () => clearTimeout(timer));
      request.on('error', reject);
      request.end(spec.body);
    })
  });
  console.log(core.summary(result));
  console.log(local ? '本地回环冒烟；速度无实际网络意义。' : 'Mac 系统网络冒烟；不代表 Loon 或代理节点结果。');
  if (result.state !== 'ok') process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}
