const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const metadata = require('../package.json');
const script = ['core.js', 'presentation.js', 'loon.js']
  .map(name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')).join('\n;\n');

// Exercise the actual adapter, including the display prefix and response status.
async function execute({ fail = () => null, argument = {}, delay = 100 } = {}) {
  const h = harness();
  const requests = [];
  const saved = [];
  const doneResults = [];
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  function request(method, options, callback) {
    const range = options.headers.Range;
    const bytes = method === 'HEAD' ? 0 : method === 'POST' ? options.body.byteLength
      : range ? Number(range.split('-')[1]) + 1 : Number(new URL(options.url).searchParams.get('bytes'));
    const spec = { ...options, method, bytes, startedAt: h.now };
    requests.push(spec);
    const failure = fail(spec, requests.length);
    h.runtime.setTimeout(() => {
      if (failure) {
        callback(failure.error, failure.status == null ? undefined : { status: failure.status });
        return;
      }
      const headers = method === 'HEAD' ? { 'Accept-Ranges': 'bytes', 'Content-Length': '4294967296' }
        : range ? { 'Content-Range': 'bytes 0-' + (bytes - 1) + '/4294967296' } : {};
      const data = method === 'POST' ? new Uint8Array(Buffer.from(JSON.stringify({ Bytes: bytes }))) : new Uint8Array(bytes);
      callback(null, { status: range ? 206 : 200, headers }, data);
    }, typeof delay === 'function' ? delay(spec) : delay);
  }
  vm.runInNewContext(script, {
    LoonSpeedtestMetadata: { version: metadata.version, releaseDate: metadata.releaseDate },
    $argument: { node: '恢复测试节点', direction: 'both', mode: 'single', adaptive: true,
      httpVersion: 'auto', warmup: 1, duration: 3, maxMB: 4, notify: false, ...argument },
    Date: { now: h.runtime.now }, setTimeout: h.runtime.setTimeout,
    console: { log: h.runtime.log },
    $httpClient: {
      head: (opts, callback) => request('HEAD', opts, callback),
      get: (opts, callback) => request('GET', opts, callback),
      post: (opts, callback) => request('POST', opts, callback)
    },
    $persistentStore: { write(value) { saved.push(JSON.parse(value)); return true; } },
    $done(value) { doneResults.push(value); complete(); }
  });
  await h.settle(finished);
  const snapshot = JSON.stringify(saved);
  await h.drain();
  assert.equal(doneResults.length, 1);
  assert.equal(JSON.stringify(saved), snapshot, '晚回调不能改写已保存结果');
  return { result: saved[0], requests, logs: h.logs, doneResults };
}

function targetRun(result, method) {
  return result.runs.find(run => run.direction === (method === 'POST' ? 'upload' : 'download'));
}

function failedReport(result, method) {
  if (method === 'HEAD') return result.preflightReports[0];
  return targetRun(result, method).warmup.requestReports[0];
}

const rejected = [
  ['certificate has expired', 'certificate'],
  ['certificate validation failed: Request timeout. ECONNRESET', 'certificate'],
  ['DNS lookup timed out; connection reset', 'dns'],
  ['getaddrinfo ENOTFOUND test.invalid', 'dns'],
  ['EAI_AGAIN', 'dns'],
  ['The server hostname could not be found.', 'dns'],
  ['Content-Range invalid; Request timeout.', 'invalid-response'],
  ['Request timeout. HTTP 403', 'http'],
  ['Connection reset; HTTP 429', 'http'],
  ['HTTP 500', 'http'],
  ['Unknown error: Connection reset', 'unknown'],
  ['Connection reset; unexplained secondary failure', 'unknown'],
  ['Request timeout. No route to host.', 'unknown'],
  ['Error Domain=LNGCDAsyncSocketErrorDomain Code=7 "Socket closed by remote peer" UserInfo={NSLocalizedDescription=certificate validation failed}', 'certificate'],
  ['Error Domain=LNGCDAsyncSocketErrorDomain Code=7 "Socket closed by remote peer" UserInfo={NSLocalizedDescription=another failure}', 'unknown'],
  ['Network request failed', 'unknown'],
  ['连接失败', 'unknown'],
  ['连接被拒绝', 'unknown'],
  ['ALPN connection failed', 'unknown']
];

for (const method of ['HEAD', 'GET', 'POST']) {
  test(method + ' 拒绝证书、所有 DNS、校验、禁止状态及未知错误，不受请求失败前缀影响', async () => {
    for (const [message, kind] of rejected) {
      const actual = await execute({ fail: spec => spec.method === method ? { error: message } : null });
      const run = targetRun(actual.result, method);
      assert.equal(actual.requests.filter(spec => spec.method === method).length, 1, message);
      assert.equal(run.recoveryAttempted, false, message);
      assert.equal(run.recovered, false, message);
      const report = failedReport(actual.result, method);
      assert.equal(report.errorKind, kind, message);
      assert.equal(report.recoverable, false, message);
      assert.equal(report.alpn, 'h2');
    }
  });
}

for (const status of [403, 429, 500, 501, 505]) {
  test('响应 HTTP ' + status + ' 优先于回调中的 timeout/reset，拒绝恢复', async () => {
    const actual = await execute({ fail: spec => spec.method === 'GET'
      ? { error: 'Request timeout. Connection reset', status } : null });
    const report = failedReport(actual.result, 'GET');
    assert.equal(report.status, status);
    assert.equal(report.errorKind, 'http');
    assert.equal(report.recoverable, false);
    assert.equal(actual.requests.filter(spec => spec.method === 'GET').length, 1);
  });
}

const allowed = [
  ['Request timeout.', undefined, 'timeout'],
  ['The request timed out.', undefined, 'timeout'],
  ['Node 冒烟请求超时', undefined, 'timeout'],
  ['ETIMEDOUT', undefined, 'timeout'],
  ['Connection reset', undefined, 'connection'],
  ['ECONNRESET', undefined, 'connection'],
  ['Socket closed by remote peer', undefined, 'connection'],
  ['Error Domain=LNGCDAsyncSocketErrorDomain Code=7 "Socket closed by remote peer" UserInfo={NSLocalizedDescription=Socket closed by remote peer}', undefined, 'connection'],
  ['Protocol error', undefined, 'protocol'],
  ['HTTP/2 protocol error', undefined, 'protocol'],
  ['ALPN negotiation failed', undefined, 'protocol'],
  ['upstream unavailable', 502, 'http'],
  ['upstream unavailable', 503, 'http'],
  ['upstream unavailable', 504, 'http']
];

for (const method of ['HEAD', 'GET', 'POST']) {
  test(method + ' 的明确瞬时故障仅恢复一次，分类与记录一致且预算包含失败尝试', async () => {
    for (const [message, status, kind] of allowed) {
      let failed = false;
      const actual = await execute({ fail: spec => {
        if (spec.method !== method || failed) return null;
        failed = true;
        return { error: message, status };
      } });
      const run = targetRun(actual.result, method);
      assert.equal(actual.result.state, 'ok', message);
      assert.equal(run.recoveryAttempted, true, message);
      assert.equal(run.recovered, true, message);
      assert.equal(run.alpn, 'h1');
      const report = method === 'HEAD' ? actual.result.preflightReports[0]
        : run.discardedPhases[0].requestReports[0];
      assert.equal(report.errorKind, kind, message);
      assert.equal(report.recoverable, true, message);
      assert.equal(report.alpn, 'h2');
      assert.equal(actual.requests.filter(spec => spec.method === method && spec.alpn === 'h2').length, 1);
      assert.ok(actual.requests.reduce((sum, spec) => sum + spec.bytes, 0) <= actual.result.budgetBytes);
      assert.equal(run.bytesPerSecond, run.completedBytes * 1000 / run.elapsedMs);
      if (method === 'HEAD') {
        assert.deepEqual(actual.result.preflightReports.map(item => [item.state, item.alpn]), [['failed', 'h2'], ['ok', 'h1']]);
      } else {
        assert.equal(run.totalScheduledBytes, run.scheduledBytes + run.warmup.scheduledBytes + run.discardedPhases[0].scheduledBytes);
        assert.equal(run.warmup.scheduledBytes, 16000);
      }
    }
  });
}

test('恢复探测仍失败时仅标记 recoveryAttempted，不能误报 recovered', async () => {
  for (const method of ['HEAD', 'GET', 'POST']) {
    const actual = await execute({ fail: spec => spec.method === method ? { error: 'Request timeout.' } : null });
    const run = targetRun(actual.result, method);
    assert.equal(run.state, 'failed');
    assert.equal(run.recoveryAttempted, true);
    assert.equal(run.recovered, false);
    assert.equal(actual.requests.filter(spec => spec.method === method).length, 2);
    assert.ok(actual.requests.reduce((sum, spec) => sum + spec.bytes, 0) <= actual.result.budgetBytes);
  }
});

test('对象错误的 localizedDescription 只提取明确消息，不记录其他对象字段', async () => {
  let first = true;
  const actual = await execute({ fail: spec => {
    if (spec.method !== 'POST' || !first) return null;
    first = false;
    return { error: { localizedDescription: 'Socket closed by remote peer', details: 'do-not-copy-extra-fields' } };
  } });
  const run = targetRun(actual.result, 'POST');
  assert.equal(run.recovered, true);
  assert.equal(run.discardedPhases[0].requestReports[0].errorKind, 'connection');
  assert.doesNotMatch(JSON.stringify(actual.result) + actual.logs.join('\n'), /do-not-copy-extra-fields/);
});

test('HEAD 成功恢复不代表后续测量成功，也不额外获得一次恢复额度', async () => {
  let headFailed = false;
  const actual = await execute({ argument: { warmup: 0 }, fail: spec => {
    if (spec.method === 'HEAD' && !headFailed) { headFailed = true; return { error: 'Connection reset' }; }
    return spec.method === 'GET' ? { error: 'Request timeout.' } : null;
  } });
  const run = targetRun(actual.result, 'GET');
  assert.equal(actual.result.preflightReports[1].state, 'ok');
  assert.equal(run.recoveryAttempted, true);
  assert.equal(run.recovered, false);
  assert.equal(run.state, 'failed');
  assert.equal(actual.requests.filter(spec => spec.method === 'GET').length, 1);
});

test('HEAD 未回调时不恢复、不开始上传，晚错误不能改写诊断', async () => {
  const actual = await execute({ argument: { requestTimeout: 1 }, delay: 5000,
    fail: spec => spec.method === 'HEAD' ? { error: 'Connection reset', status: 503 } : null });
  assert.equal(actual.requests.length, 1);
  assert.equal(actual.result.runs.length, 1);
  const report = actual.result.preflightReports[0];
  assert.equal(report.errorKind, 'callback-timeout');
  assert.equal(report.recoverable, false);
  assert.equal(report.state, 'failed');
  assert.equal(report.status, undefined);
  assert.equal(actual.result.runs[0].recoveryAttempted, false);
});

test('含多个请求的失败阶段只要有非瞬时错误就不恢复，并等待在途请求结束', async () => {
  const h = harness({ delay: 500, reply: spec => new Error(spec.worker ? 'certificate invalid' : 'Connection reset') });
  const options = core.normalizeOptions({ node: '测试节点', direction: 'download', test_source: 'cf',
    mode: 'concurrent', concurrency: 2, warmup: 0, duration: 3, maxMB: 4 });
  const result = await h.settle(core.run(options, h.runtime));
  const run = result.runs[0];
  assert.equal(h.calls.length, 2);
  assert.equal(run.requestReports.length, 2);
  assert.equal(run.elapsedMs, 650);
  assert.equal(run.recoveryAttempted, false);
  assert.equal(run.recovered, false);
  assert.equal(run.unresolvedRequests, 0);
});

test('未知对象错误不复制敏感字段，且日志明确配置 HTTP 与实际连接数的边界', async () => {
  const actual = await execute({ fail: spec => spec.method === 'POST'
    ? { error: { debug: 'do-not-log-private-value', nested: { token: 'sample-private-value' } } } : null });
  const run = targetRun(actual.result, 'POST');
  assert.equal(run.recoveryAttempted, false);
  assert.equal(run.warmup.requestReports[0].errorKind, 'unknown');
  const output = JSON.stringify(actual.result) + actual.logs.join('\n') + JSON.stringify(actual.doneResults);
  assert.doesNotMatch(output, /do-not-log-private-value|sample-private-value/);
  assert.match(output, /未知网络错误/);
  assert.ok(actual.logs.some(line => /HTTP 配置 h2/.test(line)));
  assert.equal(actual.logs.filter(line => line === '并发表示在途请求数；实际协商协议与 TCP 连接数不可由脚本确认').length, 1);
});
