const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness.cjs');
const script = ['core.js', 'presentation.js', 'loon.js'].map(name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')).join('\n;\n');

async function execute({ argument, environment, storageThrows = false, notificationThrows = false, dataType, delay = 200 } = {}) {
  const h = harness({ delay });
  let doneCount = 0;
  let completed;
  const donePromise = new Promise(resolve => { completed = resolve; });
  const notifications = [];
  const doneResults = [];
  const saved = [];
  const requests = [];
  function requestWithMethod(method, opts, callback) {
    requests.push({ ...opts, method });
    const range = opts.headers && opts.headers.Range;
    const bytes = method === 'POST' ? opts.body.byteLength : range ? Number(range.split('-')[1]) + 1 : Number(new URL(opts.url).searchParams.get('bytes'));
    h.runtime.request({ ...opts, method, bytes }).then(response => {
      callback(null, { status: response.status, headers: response.headers }, dataType === 'string' ? 'not binary' : new Uint8Array(response.bytes));
    }, error => callback(error.message));
  }
  const context = {
    $argument: typeof argument === 'string' ? 'direction=download&warmup=0&' + argument : argument && { direction: 'download', warmup: 0, ...argument },
    $environment: environment,
    Date: { now: h.runtime.now }, setTimeout: h.runtime.setTimeout,
    console: { log: h.runtime.log },
    $done(value) { doneCount++; doneResults.push(value); completed(); },
    $notification: { post(...args) { if (notificationThrows) throw new Error('无通知权限'); notifications.push(args); } },
    $persistentStore: { write(value, key) { if (storageThrows) throw new Error('存储失败'); saved.push({ value: JSON.parse(value), key }); return true; } },
    $httpClient: {
      get: (opts, callback) => requestWithMethod('GET', opts, callback),
      head: (opts, callback) => requestWithMethod('HEAD', opts, callback),
      post: (opts, callback) => requestWithMethod('POST', opts, callback)
    }
  };
  vm.runInNewContext(script, context, { filename: 'loon-speedtest.js' });
  await h.settle(donePromise);
  await h.drain(); // Late timers and callbacks must never call $done twice.
  return { doneCount, doneResults, notifications, saved, requests, logs: h.logs };
}

test('模拟 Loon API 验证 node/二进制参数、结果保存和单次结束', async () => {
  const result = await execute({ argument: { mode: 'compare', node: '节点 A', maxMB: 4, duration: 3 } });
  assert.equal(result.doneCount, 1);
  assert.equal(result.doneResults[0].title, '速度测试');
  assert.match(result.doneResults[0].htmlMessage, /↓ 下载/);
  assert.match(result.doneResults[0].htmlMessage, /4 路并发/);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.saved[0].key, 'loon-speedtest:lastResult');
  assert.equal(result.saved[0].value.state, 'ok');
  assert.equal(result.saved[0].value.runs.reduce((sum, run) => sum + run.completedBytes, 0), 4000000);
  assert.ok(result.requests.every(request => request.node === '节点 A' && request['binary-mode'] && request.alpn === 'h1' && request['auto-redirect'] === false && request.insecure === false));
});

test('没有节点上下文时给出可操作错误并不发请求', async () => {
  const result = await execute();
  assert.equal(result.requests.length, 0);
  assert.equal(result.doneCount, 1);
  assert.match(result.notifications[0][2], /未指定测速目标/);
  assert.equal(result.doneResults[0].title, '测速失败');
  assert.match(result.doneResults[0].htmlMessage, /未指定测速目标/);
});

test('查询字符串参数与节点入口兼容，可关闭通知', async () => {
  const result = await execute({ argument: 'mode=single&maxMB=4&notify=false', environment: { params: { node: '入口节点' } } });
  assert.equal(result.requests[0].node, '入口节点');
  assert.equal(result.notifications.length, 0);
  assert.match(result.doneResults[0].htmlMessage, /入口节点/);
  assert.equal(result.saved[0].value.state, 'ok');
});

test('存储与通知失败不影响脚本结束', async () => {
  const result = await execute({ argument: { node: 'DIRECT', maxMB: 4 }, storageThrows: true, notificationThrows: true });
  assert.equal(result.doneCount, 1);
  assert.ok(result.logs.some(line => line.includes('本地存储失败')));
  assert.equal(result.doneResults[0].title, '速度测试');
  assert.ok(result.doneResults[0].htmlMessage.length > 0);
});

test('Loon 未返回二进制时报告失败，不使用 Header 伪造下载量', async () => {
  const result = await execute({ argument: { node: 'DIRECT', maxMB: 4 }, dataType: 'string' });
  assert.equal(result.saved[0].value.state, 'failed');
  assert.equal(result.saved[0].value.runs[0].completedBytes, 0);
  assert.equal(result.requests.length, 1);
  assert.equal(result.doneResults[0].title, '速度测试 · 未完成');
  assert.match(result.doneResults[0].htmlMessage, /不是 Uint8Array/);
});

test('回调在兜底之后才到达时不重入、不追加比较轮次', async () => {
  const result = await execute({ argument: { node: 'DIRECT', mode: 'compare', maxMB: 4, duration: 3, requestTimeout: 1 }, delay: 10000 });
  assert.equal(result.doneCount, 1);
  assert.equal(result.saved[0].value.runs[0].state, 'incomplete');
  assert.equal(result.requests.length, 1);
  assert.match(result.doneResults[0].htmlMessage, /未按时回调/);
});

test('Apple 源通过 Loon HEAD 检查，再透传 Range 下载并展示结果', async () => {
  const result = await execute({ argument: { node: '节点 A', test_source: 'Apple CDN', mode: 'single', maxMB: 4 } });
  assert.equal(result.requests[0].method, 'HEAD');
  assert.equal(result.requests[0].headers.Range, undefined);
  assert.ok(result.requests.slice(1).every(request => request.method === 'GET' && request.headers.Range === 'bytes=0-999999'));
  assert.match(result.doneResults[0].htmlMessage, /Apple CDN/);
  assert.equal(result.saved[0].value.state, 'ok');
});

test('自定义源保留 test_url 的查询参数，不附加测速源私有参数', async () => {
  const url = 'https://downloads.example.com/test.bin?token=example';
  const result = await execute({ argument: { node: 'DIRECT', test_source: '自定义', test_url: url, maxMB: 4 } });
  assert.ok(result.requests.every(request => request.url === url));
  assert.match(result.doneResults[0].htmlMessage, /自定义/);
});

test('Loon 默认双向通过 POST 发送 Uint8Array，显式节点、超时、部分成功和结果均可用', async () => {
  const result=await execute({argument:{node:'节点 A',direction:'both',maxMB:4}});
  assert.equal(result.doneCount,1);
  assert.equal(result.saved[0].value.direction,'both');
  assert.deepEqual(Array.from(result.saved[0].value.runs,x=>x.direction),['download','upload']);
  const posts=result.requests.filter(x=>x.method==='POST');
  assert.ok(posts.length>0);
  assert.ok(posts.every(x=>Object.prototype.toString.call(x.body)==='[object Uint8Array]' && x.node==='节点 A' && x.timeout===5000 && x.headers['Content-Type']==='application/octet-stream'));
  assert.match(result.doneResults[0].htmlMessage,/↑ 上传/);
});
