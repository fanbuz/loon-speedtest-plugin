const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const options = overrides => core.normalizeOptions({ adaptive: false, httpVersion: 'h1', chunkKB: 1000, test_source: 'cf', upload_source: 'cf', direction: 'download', node: '测试节点', duration: 3, maxMB: 4, warmup: 0, ...overrides });
const goodRange = spec => ({
  status: spec.method === 'HEAD' ? 200 : 206, binary: true, bytes: spec.method === 'HEAD' ? 0 : spec.bytes,
  headers: spec.method === 'HEAD' ? { 'Accept-Ranges': 'bytes', 'Content-Length': '4294967296' } : { 'Content-Range': 'bytes 0-' + (spec.bytes - 1) + '/4294967296', 'Content-Length': String(spec.bytes) }
});

test('CF 预设完全忽略 test_url，只有自定义才校验并使用它', () => {
  assert.equal(options({ test_url: { invalid: true } }).testSource, 'cf');
  assert.equal(options({ test_source: 'Apple CDN', test_url: 'not a URL' }).testUrl, 'https://mensura.cdn-apple.com/api/v1/gm/large');
  assert.equal(options({ test_source: '自定义', test_url: 'https://example.com/test.bin' }).testUrl, 'https://example.com/test.bin');
  for (const input of [
    { test_source: 'custom' }, { test_source: 'unknown' }, { test_source: {} },
    { test_source: 'custom', test_url: 'file:///tmp/test' },
    { test_source: 'custom', test_url: 'https://user:password@example.com/test.bin' }
  ]) assert.throws(() => options(input));
});

test('Apple HEAD 200 正常通过，HEAD 不带 Range；GET 仍须 206，预算只统计 GET', async () => {
  const h = harness({ delay: 100 });
  const result = await h.settle(core.run(options({ test_source: 'Apple CDN', mode: 'concurrent' }), h.runtime));
  assert.equal(h.calls[0].method, 'HEAD');
  assert.equal(h.calls[0].bytes, 0);
  assert.equal(h.calls[0].headers.Range, undefined);
  assert.ok(h.calls.slice(1).every(call => call.start >= 100 && call.headers.Range === 'bytes=0-999999' && call.node === '测试节点'));
  assert.equal(result.runs[0].completedBytes, 4000000);
  assert.equal(result.runs[0].scheduledBytes, 4000000);
  assert.equal(result.source, 'https://mensura.cdn-apple.com/api/v1/gm/large');
  assert.equal(result.sourceInfo.status, 200);
});

test('自定义地址和查询参数原样保留；对比只进行一次 HEAD 检查', async () => {
  const url = 'https://files.example.com/test.bin?signature=example';
  const h = harness({ delay: 100 });
  const result = await h.settle(core.run(options({ test_source: 'custom', test_url: url, mode: 'compare' }), h.runtime));
  assert.equal(h.calls.filter(call => call.method === 'HEAD').length, 1);
  assert.ok(h.calls.every(call => call.url === url));
  assert.equal(result.runs.length, 2);
  assert.match(core.summary(result), /测速源：自定义/);
});

test('Apple 和自定义 HEAD 200 缺少 Accept-Ranges 仍以 GET 206 实际校验', async () => {
  for (const source of ['apple','custom']) {
    const h = harness({ delay:100, reply: spec => spec.method === 'HEAD' ? { status: 200, headers: { 'Content-Length': '4294967296' } } : goodRange(spec) });
    const result = await h.settle(core.run(options({test_source:source,test_url:'https://example.com/file'}),h.runtime));
    assert.equal(result.state,'ok');
    assert.ok(h.calls.some(x=>x.method==='GET' && x.headers.Range));
    assert.equal(result.runs[0].completedBytes,4000000);
  }
});

test('明确声明 Accept-Ranges none 时不发正文，不重试', async () => {
  const h = harness({reply:()=>({status:200,headers:{'Accept-Ranges':'none'}})});
  await assert.rejects(h.settle(core.run(options({test_source:'apple'}),h.runtime)),/Accept-Ranges: none/);
  assert.equal(h.calls.length,1);
});

test('HEAD 200 缺少范围声明但 GET 忽略 Range 时不能成功', async()=>{
  const h=harness({reply:spec=>spec.method==='HEAD'?{status:200,headers:{}}:{status:200,binary:true,bytes:spec.bytes}});
  const r=await h.settle(core.run(options({test_source:'apple'}),h.runtime));
  assert.equal(r.state,'failed');assert.equal(r.runs[0].bytesPerSecond,null);
  assert.match(r.runs[0].errors[0],/需要 HTTP 206/);
});

test('兼容端点返回合法 HEAD 206 元数据，但不依赖该行为', async () => {
  const h = harness({ reply: spec => spec.method === 'HEAD' ? { status: 206, headers: { 'Content-Range': 'bytes 0-65535/4294967296', 'Content-Length': '65536' }, bytes: 0 } : goodRange(spec) });
  const result = await h.settle(core.run(options({ test_source: 'apple' }), h.runtime));
  assert.equal(result.state, 'ok');
});

test('分段预检缺失回调时超时退出，不发 GET', async () => {
  const h = harness({ hang: true });
  await assert.rejects(h.settle(core.run(options({ test_source: 'apple' }), h.runtime)), /分段检查超时/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.now, 11000);
});

for (const [label, alter] of [
  ['忽略 Range 返回 200', response => ({ ...response, status: 200 })],
  ['Content-Range 长度错误', response => ({ ...response, headers: { 'Content-Range': 'bytes 0-99/4294967296' } })],
  ['Content-Length 错误', response => ({ ...response, headers: { ...response.headers, 'Content-Length': '4294967296' } })]
]) test('GET ' + label + '不能成为有效测速结果', async () => {
  const h = harness({ reply: spec => spec.method === 'HEAD' ? goodRange(spec) : alter(goodRange(spec)) });
  const result = await h.settle(core.run(options({ test_source: 'apple' }), h.runtime));
  assert.equal(result.state, 'failed');
  assert.equal(result.runs[0].completedBytes, 0);
  assert.equal(result.runs[0].bytesPerSecond, null);
});
