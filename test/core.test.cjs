const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const options = overrides => core.normalizeOptions({ direction: 'download', node: '测试节点', duration: 3, maxMB: 4, chunkKB: 1000, warmup: 0, ...overrides });

test('参数支持对象、JSON 和编码后的查询字符串', () => {
  assert.equal(core.normalizeOptions('node=%E6%B5%8B%E8%AF%95&mode=concurrent').node, '测试');
  assert.equal(core.normalizeOptions('{"mode":"compare"}').mode, 'compare');
  assert.equal(core.normalizeOptions().mode, 'single');
  assert.equal(core.normalizeOptions('notify=false').notify, false);
});

test('拒绝无效参数而不是静默放大流量或并发', () => {
  for (const input of [{ maxMB: 'NaN' }, { concurrency: 9 }, { duration: 0 }, { chunkKB: 63 }, { node: {} }, { mode: 'all' }, { requestTimeout: true }, { duration: 3.1 }]) {
    assert.throws(() => core.normalizeOptions(input));
  }
});

test('明确目标优先；没有目标时不默认测直连或猜 nodeInfo 字段', () => {
  assert.equal(core.resolveTarget('DIRECT', { params: { node: '代理' } }), 'DIRECT');
  assert.equal(core.resolveTarget('', { params: { node: '节点' } }), '节点');
  assert.equal(core.resolveTarget('', { params: { policyGroup: '组' } }), '组');
  assert.throws(() => core.resolveTarget('', { params: { nodeInfo: { name: '未定义结构' } } }));
});

test('MB/s 与 Mbps 使用十进制字节并正确换算', () => {
  assert.equal(core.formatRate(1000000), '1.00 MB/s (8.00 Mbps)');
});

test('单路最多一个在途请求，到期不再调度', async () => {
  const h = harness();
  const result = await h.settle(core.run(options(), h.runtime));
  assert.equal(h.peak, 1);
  assert.equal(h.calls.length, 3);
  assert.equal(result.runs[0].completedBytes, 3000000);
  assert.equal(result.runs[0].stopReason, 'duration');
  assert.equal(result.runs[0].bytesPerSecond, 1000000);
  assert.ok(h.calls.every(call => call.node === '测试节点' && call.url.startsWith('https://speed.cloudflare.com/__down?bytes=')));
  assert.equal(new Set(h.calls.map(call => call.url)).size, h.calls.length);
});

test('4 路并发用共同墙钟时间计算聚合速度，禁止把单请求时长相加', async () => {
  const h = harness();
  const result = await h.settle(core.run(options({ mode: 'concurrent' }), h.runtime));
  assert.equal(h.peak, 4);
  assert.equal(result.runs[0].completedBytes, 4000000);
  assert.equal(result.runs[0].elapsedMs, 1000);
  assert.equal(result.runs[0].bytesPerSecond, 4000000);
  assert.equal(result.runs[0].stopReason, 'budget');
});

test('请求前预留预算，尾块缩小，不因并发超发', async () => {
  const h = harness({ delay: 200 });
  const result = await h.settle(core.run(options({ mode: 'concurrent', chunkKB: 1500 }), h.runtime));
  assert.deepEqual(h.calls.map(call => call.bytes), [1500000, 1500000, 1000000]);
  assert.equal(result.runs[0].scheduledBytes, 4000000);
});

test('过短样本显式提示复测，避免把预算提前耗尽当作稳定带宽', async () => {
  const h = harness({ delay: 10 });
  const result = await h.settle(core.run(options(), h.runtime));
  assert.match(result.runs[0].warnings[0], /样本不足 2 秒/);
  assert.match(core.summary(result), /可提高数据预算/);
});

test('超过发请求窗口后等在途完成，分母包含收尾时间', async () => {
  const h = harness({ delay: 2000 });
  const result = await h.settle(core.run(options(), h.runtime));
  assert.deepEqual(h.calls.map(call => call.start), [0, 2000]);
  assert.equal(result.runs[0].elapsedMs, 4000);
  assert.equal(result.runs[0].bytesPerSecond, 500000);
});

test('对比按顺序跑且均分总预算，两阶段没有请求重叠', async () => {
  const h = harness({ delay: 500 });
  const result = await h.settle(core.run(options({ mode: 'compare' }), h.runtime));
  assert.deepEqual(result.runs.map(run => run.concurrency), [1, 4]);
  assert.deepEqual(result.runs.map(run => run.budgetBytes), [2000000, 2000000]);
  assert.equal(h.calls.reduce((sum, call) => sum + call.bytes, 0), 4000000);
  assert.ok(h.calls.slice(2).every(call => call.start >= 1000));
  assert.equal(result.comparisonRatio, 2);
});

test('错误/限流不重试；排空在途后返回无有效速度，不继续对比', async () => {
  const h = harness({ reply: () => ({ status: 429, binary: true, bytes: 0 }) });
  const result = await h.settle(core.run(options({ mode: 'compare' }), h.runtime));
  assert.equal(h.calls.length, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].bytesPerSecond, null);
  assert.match(result.runs[0].errors[0], /HTTP 429/);
});

test('部分成功后网络失败不得公布偏高的“有效速度”', async () => {
  const h = harness({ reply: spec => spec.requestId === 2 ? new Error('timeout') : ({ status: 200, binary: true, bytes: spec.bytes }) });
  const result = await h.settle(core.run(options({ mode: 'concurrent' }), h.runtime));
  assert.equal(result.state, 'failed');
  assert.equal(result.runs[0].bytesPerSecond, null);
  assert.equal(result.runs[0].completedBytes, 3000000);
  assert.equal(result.runs[0].unresolvedRequests, 0);
  assert.equal(h.calls.length, 4);
});

test('回调缺失有兜底且不进入第二阶段，未知下载量不伪造为零速', async () => {
  const h = harness({ hang: true });
  const result = await h.settle(core.run(options({ mode: 'compare' }), h.runtime));
  assert.equal(result.runs[0].state, 'incomplete');
  assert.equal(result.runs[0].unresolvedRequests, 1);
  assert.equal(result.runs[0].bytesPerSecond, null);
  assert.equal(result.runs.length, 1);
  assert.equal(h.now, 9000);
});

for (const [label, reply] of [
  ['短响应', spec => ({ status: 200, binary: true, bytes: spec.bytes - 1 })],
  ['超长响应', spec => ({ status: 200, binary: true, bytes: spec.bytes + 1 })],
  ['字符串响应', spec => ({ status: 200, binary: false, bytes: spec.bytes })],
  ['同步异常', () => { throw new Error('同步异常'); }]
]) test(label + '不能成为成功样本', async () => {
  const h = harness({ reply });
  const result = await h.settle(core.run(options(), h.runtime));
  assert.equal(result.state, 'failed');
  assert.equal(result.runs[0].successfulRequests, 0);
});
