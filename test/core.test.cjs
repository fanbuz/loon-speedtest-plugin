const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const harness = require('./harness.cjs');
const options = overrides => core.normalizeOptions({ adaptive: false, httpVersion: 'h1', chunkKB: 1000, test_source: 'cf', upload_source: 'cf', direction: 'download', node: '测试节点', duration: 3, maxMB: 4, chunkKB: 1000, warmup: 0, ...overrides });

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

test('下载与上传共用 URL 校验，保留查询特殊字符并拒绝用户信息和片段', () => {
  const url = 'https://files.example.com/a%2Fb/测试.bin?signature=a%2Bb%3D&x=%23&y=@/?';
  for (const direction of ['download', 'upload']) {
    const field = direction === 'download' ? 'test_url' : 'upload_url';
    const raw = { direction, test_source: 'custom', upload_source: 'custom', [field]: '  ' + url + '  ' };
    const normalized = core.normalizeOptions(raw);
    assert.equal(normalized[direction === 'download' ? 'testUrl' : 'uploadUrl'], url);
    for (const invalid of [undefined, {}, '', 'file:///tmp/test', 'https://user@example.com/file', 'https://example.com/file#fragment', 'https://example.com/a b']) {
      assert.throws(() => core.normalizeOptions({ ...raw, [field]: invalid }));
    }
  }
});

test('各测速源的 HEAD、GET 和 POST 保持完整请求约定，上传尾块共用原缓冲区', async () => {
  const node = '节点 <A> & B';
  const custom = 'https://files.example.com/a%2Fb?signature=a%2Bb%3D&x=%23&y=@/?';
  for (const direction of ['download', 'upload']) for (const source of ['cf', 'apple', 'custom']) {
    const configured = options({ direction, node, test_source: source, upload_source: source, test_url: custom, upload_url: custom, chunkKB: 1500, uploadChunkKB: 1500, requestTimeout: 9, httpVersion: 'h2' });
    const h = harness({ delay: 500 });
    const result = await h.settle(core.run(configured, h.runtime));
    assert.equal(result.state, 'ok');
    const url = direction === 'upload' ? configured.uploadUrl : configured.testUrl;
    const head = direction === 'download' && source !== 'cf';
    if (head) assert.deepEqual(h.calls[0], { method: 'HEAD', url, node, timeout: 9000, bytes: 0, headers: {}, alpn: 'h2', start: 0 });
    const transfers = h.calls.slice(head ? 1 : 0);
    assert.deepEqual(transfers.map(call => call.bytes), [1500000, 1500000, 1000000]);
    for (const [index, call] of transfers.entries()) {
      const headers = direction === 'upload' ? { 'Content-Type': 'application/octet-stream' } : source === 'cf' ? {} : { Range: 'bytes=0-' + (call.bytes - 1) };
      if (direction === 'upload' && source === 'cf') Object.assign(headers, { 'User-Agent': 'Mozilla/5.0', Origin: 'https://speed.cloudflare.com' });
      const expectedUrl = direction === 'download' && source === 'cf' ? url + '?bytes=' + call.bytes + '&loon_test=0-123-' + (index + 1) : url;
      assert.deepEqual({ ...call, body: undefined }, {
        method: direction === 'upload' ? 'POST' : 'GET', direction, phase: 'measurement',
        url: expectedUrl, headers, body: undefined, node, timeout: 9000, alpn: 'h2',
        bytes: call.bytes, worker: 0, requestId: index + 1, start: (index + (head ? 1 : 0)) * 500
      });
      if (direction === 'upload') {
        assert.ok(call.body instanceof Uint8Array);
        assert.equal(call.body.byteLength, call.bytes);
        assert.equal(call.body.buffer, transfers[0].body.buffer);
        assert.equal(call.body.buffer.byteLength, configured.uploadChunkBytes);
        assert.equal(call.body.byteOffset, 0);
      } else assert.equal(call.body, undefined);
    }
  }
});

test('请求构造保留预热超时与自适应正式超时，并尊重用户上限', async () => {
  for (const direction of ['download', 'upload']) for (const requestTimeout of [1, 9]) {
    const h = harness({ delay: 100 });
    const configured = options({ direction, adaptive: true, warmup: 1, requestTimeout });
    await h.settle(core.run(configured, h.runtime));
    const warmup = h.calls.filter(call => call.phase === 'warmup');
    const measurement = h.calls.filter(call => call.phase === 'measurement');
    assert.ok(warmup.length && measurement.length);
    assert.ok(warmup.every(call => call.timeout === requestTimeout * 1000));
    assert.equal(measurement[0].timeout, Math.min(requestTimeout * 1000, 3000));
    assert.ok(measurement.every(call => call.timeout <= requestTimeout * 1000));
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
  assert.equal(h.now, 11000);
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

test('节点协议读取官方示例 name/type 并标准化，JSON 字符串兼容，不影响路由',()=>{
  const environment={params:{node:'节点 A',nodeInfo:{name:'节点 A',type:'Vmess',address:'private.example',port:12345,tls:1}}};
  assert.equal(core.resolveNodeProtocol('节点 A',environment),'VMess');
  for(const [type,label] of [['Shadowsocks','Shadowsocks'],['ss','Shadowsocks'],['SSR','ShadowsocksR'],['Trojan','Trojan'],['Hysteria2','Hysteria2'],['HY2','Hysteria2'],['vless','VLESS'],['TUIC','TUIC'],['Snell','Snell'],['socks5','SOCKS5'],['AnyTLS','AnyTLS'],['anytls','AnyTLS'],[' AnYtLs ','AnyTLS']]) {
    assert.equal(core.resolveNodeProtocol('节点 A',{params:{nodeInfo:{name:'节点 A',type}}}),label);
  }
  assert.equal(core.resolveNodeProtocol('节点 A',{params:{nodeInfo:JSON.stringify({name:'节点 A',type:'Trojan'})}}),'Trojan');
  assert.equal(core.resolveTarget('节点 B',environment),'节点 B');
  assert.equal(core.resolveNodeProtocol('节点 B',environment),null);
  assert.equal(core.resolveNodeProtocol('DIRECT',environment),'直连');
});

test('目标来源保持显式优先，入口仅用于兜底和冲突判断', () => {
  const env = { params: { node: ' 节点 B ', policyGroup: '组' } };
  Object.defineProperty(env.params, 'nodeInfo', { get() { throw new Error('目标解析不得读取协议元数据'); } });
  assert.deepEqual(core.resolveTargetDetails(' 节点 A ', env), { node: '节点 A', source: 'configuration', conflict: true, entryTarget: '节点 B' });
  assert.deepEqual(core.resolveTargetDetails('节点 B', env), { node: '节点 B', source: 'configuration', conflict: false, entryTarget: '节点 B' });
  assert.deepEqual(core.resolveTargetDetails('', env), { node: '节点 B', source: 'entry-node', conflict: false, entryTarget: '节点 B' });
  assert.deepEqual(core.resolveTargetDetails('', { params: { policyGroup: '组' } }), { node: '组', source: 'entry-policy-group', conflict: false, entryTarget: '组' });
  assert.deepEqual(core.resolveTargetDetails('DIRECT', {}), { node: 'DIRECT', source: 'configuration', conflict: false, entryTarget: null });
  assert.throws(() => core.resolveTargetDetails('', {}), /未指定测速目标/);
});

test('未知协议给出稳定原因，名称不匹配时不读取 type 或无关敏感字段', () => {
  const cases = [
    [undefined, 'missing-metadata'],
    [{ params: { nodeInfo: 'bad json' } }, 'invalid-json'],
    [{ params: { nodeInfo: [] } }, 'invalid-metadata'],
    [{ params: { nodeInfo: {} } }, 'invalid-name'],
    [{ params: { nodeInfo: { name: 'B', get type() { throw new Error('不得读取其他节点的类型'); } } } }, 'name-mismatch'],
    [{ params: { node: 'B', get nodeInfo() { throw new Error('冲突入口无需读取元数据'); } } }, 'entry-mismatch'],
    [{ params: { nodeInfo: { name: 'A', type: null } } }, 'invalid-type'],
    [{ params: { nodeInfo: { name: 'A', type: 'FutureProtocol' } } }, 'unsupported-type'],
    [{ params: { nodeInfo: { get name() { throw new Error('损坏属性'); } } } }, 'invalid-metadata']
  ];
  for (const [environment, reason] of cases) {
    assert.deepEqual(core.resolveNodeProtocolDetails('A', environment), { protocol: null, reason });
    assert.equal(core.resolveNodeProtocol('A', environment), null);
  }
  const info = { name: 'A', type: 'AnyTLS' };
  for (const key of ['address', 'password', 'port', 'toJSON']) Object.defineProperty(info, key, { enumerable: true, get() { throw new Error('不得访问 ' + key); } });
  assert.deepEqual(core.resolveNodeProtocolDetails('A', { params: { node: 'A', nodeInfo: info } }), { protocol: 'AnyTLS', reason: 'recognized' });
  assert.deepEqual(core.resolveNodeProtocolDetails('DIRECT', { get params() { throw new Error('直连不读节点信息'); } }), { protocol: '直连', reason: 'direct' });
  assert.deepEqual(core.resolveNodeProtocolDetails('A', { params: { nodeInfo: JSON.stringify({ name: 'A', type: 'anytls', password: 'private-token' }) } }), { protocol: 'AnyTLS', reason: 'recognized' });
});

test('协议不能由节点名推断；缺失、不匹配、策略组或损坏元数据均显示未知',()=>{
  for(const environment of [undefined,{}, {params:{node:'美国 HY2'}}, {params:{nodeInfo:'not json'}}, {params:{nodeInfo:[]}},
    {params:{nodeInfo:{type:'Hysteria2'}}},{params:{nodeInfo:{name:'其他节点',type:'Hysteria2'}}},
    {params:{node:'其他节点',nodeInfo:{name:'美国 HY2',type:'Hysteria2'}}},
    {params:{nodeInfo:{name:'美国 HY2',type:3}}}, {params:{nodeInfo:{name:'美国 HY2',type:'<script>private-token</script>'}}}]) {
    assert.equal(core.resolveNodeProtocol('美国 HY2',environment),null);
  }
  assert.equal(core.resolveNodeProtocol('代理组',{params:{policyGroup:'代理组',nodeInfo:{name:'实际节点',type:'Trojan'}}}),null);
});
