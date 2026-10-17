const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const options = overrides => core.normalizeOptions({ node: '测试节点', duration: 3, maxMB: 8, chunkKB: 1000, warmup: 0, ...overrides });
const success = spec => ({ status: 200, binary: true, bytes: spec.method === 'POST' ? 0 : spec.bytes });

test('默认下载上传；上传预设忽略自定义字段，单独上传不要求下载 URL', () => {
  assert.equal(options().direction, 'both');
  assert.equal(options({ test_source: 'apple', upload_url: {} }).uploadUrl, 'https://speed.cloudflare.com/__up');
  assert.equal(options({ direction: 'upload', test_source: 'custom' }).uploadUrl, 'https://speed.cloudflare.com/__up');
  assert.equal(options({ direction: 'download', test_source: 'custom', test_url: 'https://a.test/file', upload_url: {} }).uploadSource, 'cf');
  assert.throws(() => options({ direction: 'all' }));
  assert.throws(() => options({ direction: 'upload', test_source: 'custom', upload_url: 'https://u:p@a.test/up' }));
});

test('上传统计成功 POST 的二进制请求体，空响应不影响计数，不做 HEAD 或 Range', async () => {
  const h = harness({ delay: 1000, reply: success });
  const r = await h.settle(core.run(options({ direction: 'upload' }), h.runtime));
  assert.equal(r.state, 'ok');
  assert.equal(r.runs[0].completedBytes, 3000000);
  assert.equal(r.runs[0].bytesPerSecond, 1000000);
  assert.ok(h.calls.every(c => c.method === 'POST' && c.url === 'https://speed.cloudflare.com/__up' && c.body.byteLength === c.bytes && !c.headers.Range));
  assert.ok(new Set(h.calls[0].body).size > 200);
  assert.match(core.summary(r), /单路上传 · Cloudflare/);
});

test('双向默认按顺序测量，每项均分总预算，墙钟不串入另一个方向', async () => {
  const h = harness({ delay: 100, reply: success });
  const r = await h.settle(core.run(options({ maxMB: 4 }), h.runtime));
  assert.equal(r.direction, 'both');
  assert.deepEqual(r.runs.map(x => x.direction), ['download', 'upload']);
  assert.deepEqual(r.runs.map(x => x.completedBytes), [2000000, 2000000]);
  assert.deepEqual(r.runs.map(x => x.elapsedMs), [200, 200]);
  assert.equal(h.calls.reduce((s,x) => s+x.bytes,0), 4000000);
  assert.ok(h.calls.filter(x => x.direction === 'upload').every(x => x.start >= 200));
});

test('双向并发与对比分别预热、排空且合计不超预算', async () => {
  const h = harness({ delay: 100, reply: success });
  const r = await h.settle(core.run(options({ mode: 'compare', maxMB: 8, warmup: 2 }), h.runtime));
  assert.deepEqual(r.runs.map(x => [x.direction,x.concurrency]), [['download',1],['download',4],['upload',1],['upload',4]]);
  assert.equal(h.peak, 4);
  assert.ok(r.runs.every(x => x.warmup && x.warmup.scheduledBytes <= 500000 && x.totalScheduledBytes <= 2000000));
  assert.equal(h.calls.reduce((s,x) => s+x.bytes,0), 8000000);
  for(let i=1;i<r.runs.length;i++) {
    const before=r.runs[i-1]; const current=r.runs[i];
    assert.ok(current.warmup.startedAt >= before.startedAt + before.elapsedMs);
  }
});

test('上传错误不重试、不把响应大小作为速度，保留成功下载结果', async () => {
  const h = harness({ delay: 100, reply: spec => spec.method === 'POST' ? { status: 403, binary: true, bytes: 999999999 } : success(spec) });
  const r = await h.settle(core.run(options({ maxMB: 4 }), h.runtime));
  assert.equal(r.state, 'partial');
  assert.equal(r.runs[0].state, 'ok');
  assert.equal(r.runs[1].bytesPerSecond, null);
  assert.equal(r.runs[1].completedBytes, 0);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
});

test('下载明确失败后仍测试上传，未回调的下载则阻止后续传输', async () => {
  const h = harness({ reply: spec => spec.method === 'GET' ? { status: 429 } : success(spec) });
  const r = await h.settle(core.run(options(), h.runtime));
  assert.equal(r.state, 'partial');
  assert.equal(r.runs[1].state, 'ok');
  const hung = harness({ hang: true });
  const incomplete = await hung.settle(core.run(options(), hung.runtime));
  assert.equal(incomplete.runs.length,1);
  assert.ok(hung.calls.every(x => x.method === 'GET'));
});

test('Apple 下载与 CF 上传分源标记；自定义上传 URL 完整保留且不加 Range', async () => {
  const h = harness({ delay: 100 });
  const r = await h.settle(core.run(options({ test_source: 'apple' }), h.runtime));
  assert.deepEqual(r.runs.map(x=>x.testSource),['apple','cf']);
  const custom=harness({reply:success});
  const url='https://example.com/up?token=example';
  await custom.settle(core.run(options({ direction:'upload',test_source:'custom',upload_url:url }),custom.runtime));
  assert.ok(custom.calls.every(x=>x.url===url && !x.headers.Range));
});

test('上传预热失败时不进入正式阶段，也不继续并发比较', async () => {
  const h=harness({reply:()=>({status:500,binary:true,bytes:0})});
  const r=await h.settle(core.run(options({direction:'upload',mode:'compare',warmup:2}),h.runtime));
  assert.equal(r.runs.length,1);
  assert.equal(r.runs[0].stopReason,'warmup-error');
  assert.equal(r.runs[0].bytesPerSecond,null);
  assert.equal(h.calls.length,1);
});

test('双向 Apple HEAD 失联时不启动上传；明确不支持 Range 仍可单独得到上传结果', async () => {
  const hung=harness({hang:true});
  const r=await hung.settle(core.run(options({test_source:'apple'}),hung.runtime));
  assert.equal(r.runs.length,1);assert.equal(hung.calls.length,1);
  const unsupported=harness({reply:spec=>spec.method==='HEAD'?{status:200,headers:{'Accept-Ranges':'none'}}:success(spec)});
  const partial=await unsupported.settle(core.run(options({test_source:'apple'}),unsupported.runtime));
  assert.equal(partial.state,'partial');assert.equal(partial.runs[1].direction,'upload');
});
