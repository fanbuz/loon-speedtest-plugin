const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const options = overrides => core.normalizeOptions({ node: '测试节点', duration: 3, maxMB: 4, ...overrides });
const goodRange = spec => ({
  status: 206, binary: true, bytes: spec.method === 'HEAD' ? 0 : spec.bytes,
  headers: { 'Content-Range': 'bytes 0-' + (spec.bytes - 1) + '/4294967296', 'Content-Length': String(spec.bytes) }
});

test('默认 CF；预设源完全忽略 test_url，只有自定义才校验并使用它', () => {
  assert.equal(options({ test_url: { invalid: true } }).testSource, 'cf');
  assert.equal(options({ test_source: 'Apple CDN', test_url: 'not a URL' }).testUrl, 'https://mensura.cdn-apple.com/api/v1/gm/large');
  assert.equal(options({ test_source: '自定义', test_url: 'https://example.com/test.bin' }).testUrl, 'https://example.com/test.bin');
  for (const input of [
    { test_source: 'custom' }, { test_source: 'unknown' }, { test_source: {} },
    { test_source: 'custom', test_url: 'file:///tmp/test' },
    { test_source: 'custom', test_url: 'https://user:password@example.com/test.bin' }
  ]) assert.throws(() => options(input));
});

test('Apple HEAD 先校验分段支持，GET 使用有界 Range，数据预算只统计 GET', async () => {
  const h = harness({ delay: 100 });
  const result = await h.settle(core.run(options({ test_source: 'Apple CDN', mode: 'concurrent' }), h.runtime));
  assert.equal(h.calls[0].method, 'HEAD');
  assert.equal(h.calls[0].bytes, 65536);
  assert.ok(h.calls.slice(1).every(call => call.start >= 100 && call.headers.Range === 'bytes=0-999999' && call.node === '测试节点'));
  assert.equal(result.runs[0].completedBytes, 4000000);
  assert.equal(result.runs[0].scheduledBytes, 4000000);
  assert.equal(result.source, 'https://mensura.cdn-apple.com/api/v1/gm/large');
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

test('不支持 HEAD Range 的源在正文下载前终止', async () => {
  const h = harness({ reply: () => ({ status: 200, headers: { 'Content-Length': '4294967296' } }) });
  await assert.rejects(h.settle(core.run(options({ test_source: 'apple' }), h.runtime)), /必须支持 HTTP Range/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'HEAD');
});

test('分段预检缺失回调时超时退出，不发 GET', async () => {
  const h = harness({ hang: true });
  await assert.rejects(h.settle(core.run(options({ test_source: 'apple' }), h.runtime)), /分段检查超时/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.now, 6000);
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
