import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import { performance } from 'node:perf_hooks';
import core from '../src/core.js';

// Node smoke verifies the shared algorithm and endpoint only. It cannot use Loon nodes.
const args = process.argv.slice(2);
let local = false;
let omitAcceptRanges = false;
let source = 'apple';
let uploadSource = 'apple';
let uploadUrl;
let testUrl;
let warmup = 2;
let direction = 'both';
let httpVersion = 'auto';
let adaptive = true;
while (args.length) {
  const option = args.shift();
  if (option === '--local') local = true;
  else if (option === '--omit-accept-ranges') omitAcceptRanges = true;
  else if (option === '--http-version' && args.length) httpVersion = args.shift();
  else if (option === '--fixed') adaptive = false;
  else if (option === '--source' && args.length) source = args.shift();
  else if (option === '--upload-source' && args.length) uploadSource = args.shift();
  else if (option === '--upload-url' && args.length) uploadUrl = args.shift();
  else if (option === '--test-url' && args.length) testUrl = args.shift();
  else if (option === '--direction' && args.length) direction = args.shift();
  else if (option === '--warmup' && args.length) warmup = args.shift();
  else throw new Error('用法：npm run smoke -- [--local] [--http-version auto|h1|h2] [--fixed] [--source cf|apple|custom] [--test-url URL] [--upload-source apple|cf|custom] [--upload-url URL] [--warmup 秒] [--direction both|download|upload]');
}
if (omitAcceptRanges && !local) throw new Error('--omit-accept-ranges 只能用于本地服务');
let server;
if (local) {
  server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let received = 0;
      req.on('data', chunk => { received += chunk.length; });
      req.on('end', () => {
        if (received !== Number(req.headers['content-length'])) { res.writeHead(400); res.end(); return; }
        const receipt = JSON.stringify({ Bytes: received });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(receipt) }); res.end(receipt);
      });
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...(omitAcceptRanges ? {} : { 'Accept-Ranges': 'bytes' }), 'Content-Length': '4294967296' });
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
const options = core.normalizeOptions({ node: 'DIRECT', mode: 'compare', maxMB: 4, chunkKB: 250, duration: 3, test_source: source, test_url: testUrl, upload_source: uploadSource, upload_url: uploadUrl, warmup, direction, httpVersion, adaptive });
const sessions = new Map();
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });
function networkRequest(spec) {
  return new Promise((resolve, reject) => {
    const url = local ? `http://127.0.0.1:${server.address().port}/${spec.method === 'POST' ? '__up' : '__down'}?bytes=${spec.bytes}` : spec.url;
    const parsed = new URL(url);
    const headers = { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache, no-store', ...spec.headers, ...(spec.body ? { 'Content-Length': spec.body.byteLength } : {}) };
    let request;
    let status, responseHeaders;
    let bytes = 0;
    const chunks = [];
    let timer;
    const fail = error => { if (request) request.destroy(); clearTimeout(timer); reject(error); };
    const onData = chunk => {
      bytes += chunk.length;
      if (spec.method === 'POST' && bytes <= 65536) chunks.push(chunk);
      if (bytes > (spec.method === 'POST' ? 65536 : spec.bytes)) fail(new Error('服务器返回的数据超过请求大小'));
    };
    const onEnd = () => {
      clearTimeout(timer);
      let uploadBytes = null;
      if (spec.method === 'POST' && bytes <= 4096) { try { uploadBytes = JSON.parse(Buffer.concat(chunks).toString('utf8')).Bytes; } catch {} }
      resolve({ status, headers: responseHeaders, binary: true, bytes, uploadBytes });
    };
    if (!local && parsed.protocol === 'https:' && spec.alpn === 'h2') {
      let session = sessions.get(parsed.origin);
      if (!session || session.closed || session.destroyed) {
        session = http2.connect(parsed.origin);
        session.on('error', () => {}); // Stream callbacks deliver request failures.
        sessions.set(parsed.origin, session);
      }
      request = session.request({ ':path': parsed.pathname + parsed.search, ':method': spec.method || 'GET', ...headers });
      request.on('response', h => { status = h[':status']; responseHeaders = h; });
      request.on('data', onData);
      request.on('end', onEnd);
      request.on('error', fail);
    } else {
      request = (parsed.protocol === 'http:' ? http : https).request(url, {
        method: spec.method || 'GET', agent: parsed.protocol === 'http:' ? httpAgent : httpsAgent, headers
      }, response => {
        status = response.statusCode; responseHeaders = response.headers;
        response.on('data', onData); response.on('error', fail); response.on('end', onEnd);
      });
      request.on('error', fail);
    }
    timer = setTimeout(() => fail(new Error('Node 冒烟请求超时')), spec.timeout);
    request.on('close', () => clearTimeout(timer));
    request.end(spec.body);
  });
}
try {
  const result = await core.run(options, {
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
    log: text => console.log(text),
    request: networkRequest
  });
  console.log(core.summary(result));
  console.log(local ? '本地回环冒烟；速度无实际网络意义。' : 'Mac 系统网络冒烟；不代表 Loon 或代理节点结果。');
  if (result.state !== 'ok') process.exitCode = 1;
} finally {
  for (const session of sessions.values()) session.destroy();
  httpAgent.destroy(); httpsAgent.destroy();
  if (server) await new Promise(resolve => server.close(resolve));
}
