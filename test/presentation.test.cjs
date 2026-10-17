const { test } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../src/presentation.js');

function fixture() {
  return { node: '示例节点 · US', testSource: 'cf', state: 'ok', runs: [{
    state: 'ok', concurrency: 1, completedBytes: 18000000, elapsedMs: 10375, targetDurationMs: 10000,
    bytesPerSecond: 18000000 / 10.375, stopReason: 'duration', errors: [], warnings: [],
    warmup: { completedBytes: 4000000, elapsedMs: 2100 }, totalCompletedBytes: 22000000, totalElapsedMs: 12475
  }], comparisonRatio: null };
}

test('结果页突出 Mbps，转换值来自同一原始速度，并分别展示预热、测量和收尾', () => {
  const html = view.render(fixture());
  assert.match(html, />13\.88<\/span>/);
  assert.match(html, /1\.735 MB\/s/);
  assert.match(html, /18\.00/);
  assert.match(html, /10\.38/);
  assert.match(html, /在途收尾 0\.38 秒/);
  assert.match(html, /预热 2\.10 秒 · 4\.00 MB，不计入平均速度/);
  assert.match(html, /本轮已确认数据 22\.00 MB/);
  assert.doesNotMatch(html, /停止原因 duration/);
});

test('动态节点和错误信息转义，页面无脚本、外部字体和远端图片依赖', () => {
  const result = fixture();
  result.node = '<img src=x onerror="alert(1)"> & 节点';
  result.runs[0].errors = ['<script>alert(1)</script>'];
  const html = view.render(result);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<img|<iframe|https?:\/\//i);
});

test('失败结果不显示成功速度，保留错误和已确认数据', () => {
  const result = fixture();
  result.state = 'failed'; result.runs[0].state = 'failed'; result.runs[0].bytesPerSecond = null;
  const html = view.render(result);
  assert.match(html, /本轮无有效速度结果/);
  assert.doesNotMatch(html, />13\.88<\/span>/);
  assert.match(view.error('HEAD <200>'), /HEAD &lt;200&gt;/);
});
