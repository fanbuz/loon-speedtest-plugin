const { test } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../src/presentation.js');

function run(direction, requestedConcurrency, concurrency) {
  return {
    direction, requestedConcurrency, concurrency, state: 'ok', testSource: 'apple',
    bytesPerSecond: 1000000, totalElapsedMs: 3000, totalCompletedBytes: 3000000,
    errors: [], warnings: []
  };
}
function render(mode, runs) {
  return view.render({ node: '测试节点', direction: 'both', mode, state: 'ok', runs });
}

test('并发恢复后同时保留所选模式、原请求数与实际并发', () => {
  for (const [requested, actual] of [[2, 1], [4, 2]]) {
    const html = render('concurrent', [run('download', requested, actual), run('upload', requested, actual)]);
    assert.ok(html.includes('并发模式（实际 ' + actual + ' 路）'));
    assert.ok(html.includes((actual === 1 ? '单路' : actual + ' 路并发') + '（原 ' + requested + ' 路）'));
    assert.match(html, />8\.00<\/span>/);
  }
});

test('双向仅一项降载时不把全部结果标为单路', () => {
  const html = render('concurrent', [run('download', 2, 2), run('upload', 2, 1)]);
  assert.match(html, /并发模式（部分降载）/);
  assert.match(html, /2 路并发  /);
  assert.match(html, /单路（原 2 路）/);
});

test('无降载与单路结果不增加恢复模式提示', () => {
  for (const [mode, concurrency, label] of [['concurrent', 4, '并发模式'], ['single', 1, '单路']]) {
    const html = render(mode, [run('download', concurrency, concurrency), run('upload', concurrency, concurrency)]);
    assert.ok(html.includes(label + ' · 6.0 秒'));
    assert.doesNotMatch(html, /部分降载|（实际|（原/);
  }
});

test('对比中并发项退到单路仍区别于原单路样本', () => {
  const html = render('compare', [run('download', 1, 1), run('download', 2, 1)]);
  assert.match(html, /单路 \/ 并发对比/);
  assert.match(html, /单路（原 2 路）/);
  assert.match(html, /↑ 上传 · 未开始/);
});
