const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const options = overrides => core.normalizeOptions({ direction: 'download', node: '测试节点', mode: 'single', duration: 3, maxMB: 16, chunkKB: 1000, ...overrides });

test('预热默认 2 秒发请求窗口，可关闭且拒绝超出上限的值', () => {
  assert.equal(options().warmupMs, 2000);
  assert.equal(options({ warmup: 0 }).warmupMs, 0);
  assert.throws(() => options({ warmup: 6 }));
});

test('冷启动预热不进入正式平均速度，预热请求结束后才开始正式计时', async () => {
  const h = harness({ delay: spec => spec.phase === 'warmup' ? 1500 : 1000 });
  const result = await h.settle(core.run(options(), h.runtime));
  const run = result.runs[0];
  assert.equal(run.warmup.elapsedMs, 3000);
  assert.equal(run.warmup.completedBytes, 2000000);
  assert.equal(run.elapsedMs, 3000);
  assert.equal(run.completedBytes, 3000000);
  assert.equal(run.bytesPerSecond, 1000000);
  assert.equal(run.totalElapsedMs, 6000);
  assert.equal(run.totalCompletedBytes, 5000000);
  assert.ok(h.calls.filter(call => call.phase === 'measurement').every(call => call.start >= 3000));
});

test('预热和测量合并限制总数据预算，预热最多占本轮四分之一', async () => {
  const h = harness({ delay: 100 });
  const result = await h.settle(core.run(options({ maxMB: 4 }), h.runtime));
  const run = result.runs[0];
  assert.equal(run.warmup.scheduledBytes, 1000000);
  assert.equal(run.scheduledBytes, 3000000);
  assert.equal(run.totalScheduledBytes, 4000000);
  assert.equal(h.calls.reduce((sum, call) => sum + call.bytes, 0), 4000000);
});

test('小预算并发预热调整块大小，使每个 worker 都有请求', async () => {
  const h = harness({ delay: 100 });
  await h.settle(core.run(options({ mode: 'concurrent', maxMB: 4, concurrency: 8 }), h.runtime));
  const warm = h.calls.filter(call => call.phase === 'warmup');
  assert.equal(new Set(warm.map(call => call.worker)).size, 8);
  assert.ok(warm.every(call => call.bytes === 125000));
});

test('对比模式每一轮独立预热，所有预热和正式阶段都不重叠', async () => {
  const h = harness({ delay: 500 });
  const result = await h.settle(core.run(options({ mode: 'compare', maxMB: 8 }), h.runtime));
  assert.equal(result.runs.length, 2);
  assert.ok(result.runs.every(run => run.warmup && run.totalScheduledBytes <= 4000000));
  assert.equal(h.calls.reduce((sum, call) => sum + call.bytes, 0), 8000000);
  const phases = h.calls.map(call => call.phase);
  const switches = phases.filter((phase, index) => index === 0 || phase !== phases[index - 1]);
  assert.deepEqual(switches, ['warmup', 'measurement', 'warmup', 'measurement']);
});

test('预热失败不进入正式测速，也不启动下一轮', async () => {
  const h = harness({ reply: () => new Error('预热连接失败') });
  const result = await h.settle(core.run(options({ mode: 'compare' }), h.runtime));
  assert.equal(h.calls.length, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].stopReason, 'warmup-error');
  assert.equal(result.runs[0].completedBytes, 0);
  assert.equal(result.runs[0].bytesPerSecond, null);
  assert.match(core.summary(result), /预热未完成/);
});

test('预热回调缺失时保留不完整状态，不把冷启动请求带入正式或下一轮', async () => {
  const h = harness({ hang: true });
  const result = await h.settle(core.run(options({ mode: 'compare' }), h.runtime));
  assert.equal(h.calls.length, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].warmup.state, 'incomplete');
  assert.equal(result.runs[0].warmup.unresolvedRequests, 1);
  assert.equal(result.runs[0].bytesPerSecond, null);
  assert.equal(result.runs[0].completedBytes, 0);
});

test('复现用户截图：18 MB / 10.376 秒正确显示 1.73 MB/s 和 13.88 Mbps', async () => {
  const h = harness({ delay: 10376 / 18 });
  const result = await h.settle(core.run(options({ duration: 10, maxMB: 64, warmup: 0 }), h.runtime));
  const run = result.runs[0];
  assert.equal(run.completedBytes, 18000000);
  assert.ok(Math.abs(run.elapsedMs - 10376) < 0.0001);
  assert.equal(core.formatRate(run.bytesPerSecond), '1.73 MB/s (13.88 Mbps)');
  assert.equal((run.elapsedMs / 1000).toFixed(2), '10.38');
  assert.match(core.summary(result), /已达到测量时长/);
});
