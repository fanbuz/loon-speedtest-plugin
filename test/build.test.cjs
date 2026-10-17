const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.join(__dirname, '../scripts/build.mjs');

function withBuild(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'loon-build-test-'));
  const build = (...args) => spawnSync(process.execPath, [script, ...args, '--out-dir', directory], { encoding: 'utf8' });
  try { run(directory, build); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('OSS 构建使用完整对象目录，生成同目录绝对脚本 URL', () => withBuild((directory, build) => {
  const result = build('--base-url', 'https://assets.example.com/loon/dist/');
  assert.equal(result.status, 0, result.stderr);
  const plugin = readFileSync(path.join(directory, 'LoonSpeedtest.plugin'), 'utf8');
  assert.match(plugin, /script\("https:\/\/assets\.example\.com\/loon\/dist\/loon-speedtest\.js\?v=0\.2\.0"/);
  assert.doesNotMatch(plugin, /192\.168\./);
  assert.match(plugin, /#!icon = https:\/\/assets\.example\.com\/loon\/dist\/icon\.png/);
  assert.match(readFileSync(path.join(directory, 'loon-speedtest.js'), 'utf8'), /v0\.2\.0/);
}));

test('默认构建固定使用当前仓库的 GitHub Raw，避免遗留局域网地址', () => withBuild((directory, build) => {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  const plugin = readFileSync(path.join(directory, 'LoonSpeedtest.plugin'), 'utf8');
  assert.match(plugin, /script\("https:\/\/raw\.githubusercontent\.com\/fanbuz\/loon-speedtest-plugin\/main\/dist\/loon-speedtest\.js\?v=0\.2\.0"/);
  assert.doesNotMatch(plugin, /192\.168\./);
  assert.match(plugin, /#!name = 速度测试/);
  assert.match(plugin, /direction = select,"both"/);
  assert.match(plugin, /upload_url = input/);
  assert.match(plugin, /timeout=300/);
}));

test('只有明确 --local 才生成本地脚本引用', () => withBuild((directory, build) => {
  const result = build('--local');
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(path.join(directory, 'LoonSpeedtest.plugin'), 'utf8'), /script\("loon-speedtest\.js"/);
  assert.match(result.stdout, /本地脚本引用配置/);
}));

test('拒绝不明确的目录 URL 和冲突参数', () => withBuild((directory, build) => {
  const target = path.join(directory, 'LoonSpeedtest.plugin');
  writeFileSync(target, 'existing remote installer');
  for (const args of [
    ['--base-url', 'https://assets.example.com/loon'],
    ['--base-url', 'https://user:pass@assets.example.com/loon/'],
    ['--base-url', 'https://assets.example.com/loon/?signature=value'],
    ['--base-url', 'file:///tmp/loon/'],
    ['--base-url', 'https://assets.example.com/loon/', '--local']
  ]) {
    assert.notEqual(build(...args).status, 0, args.join(' '));
    assert.equal(readFileSync(target, 'utf8'), 'existing remote installer');
  }
}));
