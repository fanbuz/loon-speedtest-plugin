const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const harness = require('./harness.cjs');

const root = path.join(__dirname, '..');
const artifacts = ['LoonSpeedtest.plugin', 'loon-speedtest.js', 'icon.png'];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loon-release-test-'));
  for (const name of ['src', 'scripts', 'assets']) fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(directory, 'package.json'));
  const temporary = path.join(directory, 'temporary');
  fs.mkdirSync(temporary);
  const run = (...args) => spawnSync(process.execPath, args, {
    cwd: directory, encoding: 'utf8', env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary }
  });
  const read = name => fs.readFileSync(path.join(directory, name));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), value);
  const packageInfo = JSON.parse(read('package.json'));
  function readme(version = packageInfo.version) {
    const raw = 'https://raw.githubusercontent.com/fanbuz/loon-speedtest-plugin/main/dist/LoonSpeedtest.plugin?v=' + encodeURIComponent(version);
    const importer = 'https://www.nsloon.com/openloon/import?plugin=' + encodeURIComponent(raw);
    write('README.md', '<a href="' + importer + '">安装</a>\n<a href="' + raw + '">Raw</a>\n日志首行应包含 `v' + version + '`。\n历史参考 v0.1.0。\n');
  }
  readme();
  return { directory, temporary, run, read, write, readme, packageInfo, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

function built(f, ...args) {
  const result = f.run('scripts/build.mjs', ...args);
  assert.equal(result.status, 0, result.stderr);
}

function snapshotDist(f) {
  return artifacts.map(name => {
    try { return f.read('dist/' + name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
}

async function executeBundle(source) {
  const h = harness({ delay: 200 });
  const saved = [];
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const request = method => (options, callback) => {
    const bytes = method === 'POST' ? options.body.byteLength : Number(new URL(options.url).searchParams.get('bytes'));
    h.runtime.request({ ...options, method, bytes }).then(response => {
      callback(null, { status: response.status, headers: response.headers }, new Uint8Array(response.bytes));
    }, error => callback(error.message));
  };
  vm.runInNewContext(source, {
    $argument: { node: '节点 A', direction: 'both', test_source: 'cf', upload_source: 'cf', adaptive: false, warmup: 0, duration: 3, maxMB: 4 },
    Date: { now: h.runtime.now }, setTimeout: h.runtime.setTimeout,
    console: { log: h.runtime.log }, $done: complete,
    $persistentStore: { write: value => { saved.push(JSON.parse(value)); return true; } },
    $httpClient: { get: request('GET'), post: request('POST') }
  });
  await h.settle(done);
  await h.drain();
  return { saved, logs: h.logs };
}

test('版本和日期仅修改 package 后，Node 与远端/本地 Loon 结果、日志及缓存键一致', async () => {
  const f = fixture();
  try {
    const version = '1.2.3-beta.1+build.7';
    const releaseDate = '2028-02-29';
    f.write('package.json', JSON.stringify({ ...f.packageInfo, version, releaseDate }));
    const node = f.run('-e', 'const core = require("./src/core.js"); const h = require(' + JSON.stringify(path.join(__dirname, 'harness.cjs')) + ')(); h.settle(core.run(core.normalizeOptions({node:"A",direction:"download",test_source:"cf",adaptive:false,warmup:0,maxMB:4,duration:3}), h.runtime)).then(result => console.log(JSON.stringify({version:core.version,releaseDate:core.releaseDate,resultVersion:result.version})));');
    assert.equal(node.status, 0, node.stderr);
    assert.deepEqual(JSON.parse(node.stdout), { version, releaseDate, resultVersion: version });

    built(f);
    built(f, '--local', '--out-dir', 'local');
    for (const target of ['dist', 'local']) {
      const script = f.read(target + '/loon-speedtest.js').toString();
      const plugin = f.read(target + '/LoonSpeedtest.plugin').toString();
      assert.ok(script.startsWith('// Loon Speedtest v' + version + ' '));
      assert.ok(plugin.includes('#!date = ' + releaseDate));
      assert.ok(plugin.includes('#!desc = v' + version + ' '));
      const execution = await executeBundle(script); // No require/module globals are provided.
      assert.equal(execution.saved[0].version, version);
      assert.ok(execution.logs.includes('节点速度测试 v' + version + ' | 脚本已加载'));
    }
    const remote = f.read('dist/LoonSpeedtest.plugin').toString();
    const scriptUrl = remote.match(/generic script-path=([^,]+),/)[1];
    const iconUrl = remote.match(/#!icon = (.+)/)[1];
    assert.equal(new URL(scriptUrl).searchParams.get('v'), version);
    assert.equal(new URL(iconUrl).searchParams.get('v'), version);
    f.readme(version);
    const check = f.run('scripts/check.mjs');
    assert.equal(check.status, 0, check.stderr);
  } finally { f.cleanup(); }
});

test('缺失或非法发行元数据在 Node 加载和构建前拒绝，既有产物不被覆盖', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.directory, 'dist'));
    f.write('dist/loon-speedtest.js', 'existing distribution');
    for (const override of [
      { version: undefined }, { version: '0.5' }, { version: '01.2.3' }, { version: '1.2.3-01' }, { version: '0.5.0\n' },
      { releaseDate: undefined }, { releaseDate: '2026-2-01' }, { releaseDate: '2026-02-29' }, { releaseDate: '2026-13-01' }
    ]) {
      f.write('package.json', JSON.stringify({ ...f.packageInfo, ...override }));
      for (const args of [['scripts/build.mjs'], ['-e', 'require("./src/core.js")']]) {
        const result = f.run(...args);
        assert.notEqual(result.status, 0, JSON.stringify(override));
        assert.match(result.stderr, /version|releaseDate/);
      }
      assert.equal(f.read('dist/loon-speedtest.js').toString(), 'existing distribution');
    }
  } finally { f.cleanup(); }
});

test('相同元数据重复构建得到相同发行文件，构建模式不改变脚本内容', () => {
  const f = fixture();
  try {
    built(f);
    const initial = snapshotDist(f);
    built(f, '--out-dir', 'second');
    for (const [index, name] of artifacts.entries()) assert.deepEqual(f.read('second/' + name), initial[index]);
    built(f, '--local', '--out-dir', 'local');
    assert.deepEqual(f.read('local/loon-speedtest.js'), f.read('dist/loon-speedtest.js'));
  } finally { f.cleanup(); }
});

test('一致性检查识别源码、产物及缺失文件，成功失败均不改写 dist 且清理临时目录', () => {
  const f = fixture();
  try {
    built(f);
    const originalSource = f.read('src/core.js');
    const baseline = snapshotDist(f);
    const scenarios = [
      { name: '一致产物', file: null, status: 0, mutate: () => {} },
      { name: '源码已变', file: 'loon-speedtest.js', mutate: () => f.write('src/core.js', originalSource + '\n// changed source\n') },
      ...artifacts.map(name => ({ name: '改写 ' + name, file: name, mutate: () => f.write('dist/' + name, 'stale artifact') })),
      ...artifacts.map(name => ({ name: '缺失 ' + name, file: name, mutate: () => fs.unlinkSync(path.join(f.directory, 'dist', name)) }))
    ];
    for (const scenario of scenarios) {
      f.write('src/core.js', originalSource);
      artifacts.forEach((name, index) => f.write('dist/' + name, baseline[index]));
      scenario.mutate();
      const before = snapshotDist(f);
      const result = f.run('scripts/check.mjs');
      assert.equal(result.status, scenario.status ?? 1, scenario.name + '\n' + result.stderr);
      if (scenario.file) {
        assert.ok(result.stderr.includes('dist/' + scenario.file), result.stderr);
        assert.match(result.stderr, /npm run build/);
      }
      assert.deepEqual(snapshotDist(f), before, scenario.name);
      assert.deepEqual(fs.readdirSync(f.temporary), [], scenario.name);
    }
    f.write('src/core.js', originalSource);
    built(f);
    assert.equal(f.run('scripts/check.mjs').status, 0);
  } finally { f.cleanup(); }
});

test('README 只校验当前安装链接和日志版本提示，历史版本记录不影响检查', () => {
  const f = fixture();
  try {
    built(f);
    const correct = f.read('README.md').toString();
    assert.equal(f.run('scripts/check.mjs').status, 0);
    const version = f.packageInfo.version;
    for (const changed of [
      correct.replace('?v=' + version, '?v=0.0.1'),
      correct.replace('%3Fv%3D' + version, '%3Fv%3D0.0.1'),
      correct.replace('`v' + version + '`', '`v0.0.1`'),
      correct.replace(/<a href="[^\n]+>Raw<\/a>/, '')
    ]) {
      assert.notEqual(changed, correct);
      f.write('README.md', changed);
      const before = snapshotDist(f);
      const result = f.run('scripts/check.mjs');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /README.md/);
      assert.deepEqual(snapshotDist(f), before);
    }
  } finally { f.cleanup(); }
});
