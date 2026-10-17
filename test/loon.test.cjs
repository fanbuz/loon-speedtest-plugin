const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./harness.cjs');
const script = ['core.js', 'presentation.js', 'loon.js'].map(name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')).join('\n;\n');

async function execute({ argument, environment, storageThrows = false, notificationThrows = false, dataType, reply, callbackError, delay = 200 } = {}) {
  const h = harness({ delay, reply });
  let doneCount = 0;
  let completed;
  const donePromise = new Promise(resolve => { completed = resolve; });
  const notifications = [];
  const doneResults = [];
  const saved = [];
  const requests = [];
  function requestWithMethod(method, opts, callback) {
    requests.push({ ...opts, method });
    if (method==='POST' && callbackError) {
      h.runtime.setTimeout(()=>callback(callbackError,{status:502}),100);
      return;
    }
    const range = opts.headers && opts.headers.Range;
    const bytes = method === 'POST' ? opts.body.byteLength : range ? Number(range.split('-')[1]) + 1 : Number(new URL(opts.url).searchParams.get('bytes'));
    h.runtime.request({ ...opts, method, bytes }).then(response => {
      callback(null, { status: response.status, headers: response.headers }, response.data !== undefined ? response.data : dataType === 'string' ? 'not binary' : response.uploadBytes != null ? new Uint8Array(Buffer.from(JSON.stringify({ Bytes: response.uploadBytes }))) : new Uint8Array(response.bytes));
    }, error => callback(error.message));
  }
  const context = {
    $argument: typeof argument === 'string' ? 'direction=download&adaptive=false&httpVersion=h1&chunkKB=1000&test_source=cf&upload_source=cf&warmup=0&' + argument : argument && { direction: 'download', adaptive: false, httpVersion: 'h1', chunkKB: 1000, test_source: 'cf', upload_source: 'cf', warmup: 0, ...argument },
    $environment: environment,
    Date: { now: h.runtime.now }, setTimeout: h.runtime.setTimeout,
    console: { log: h.runtime.log },
    $done(value) { doneCount++; doneResults.push(value); completed(); },
    $notification: { post(...args) { if (notificationThrows) throw new Error('无通知权限'); notifications.push(args); } },
    $persistentStore: { write(value, key) { if (storageThrows) throw new Error('存储失败'); saved.push({ value: JSON.parse(value), key }); return true; } },
    $httpClient: {
      get: (opts, callback) => requestWithMethod('GET', opts, callback),
      head: (opts, callback) => requestWithMethod('HEAD', opts, callback),
      post: (opts, callback) => requestWithMethod('POST', opts, callback)
    }
  };
  vm.runInNewContext(script, context, { filename: 'loon-speedtest.js' });
  await h.settle(donePromise);
  await h.drain(); // Late timers and callbacks must never call $done twice.
  return { doneCount, doneResults, notifications, saved, requests, logs: h.logs };
}

test('模拟 Loon API 验证 node/二进制参数、结果保存和单次结束', async () => {
  const result = await execute({ argument: { mode: 'compare', node: '节点 A', maxMB: 4, duration: 3 } });
  assert.equal(result.doneCount, 1);
  assert.equal(result.doneResults[0].title, '节点速度测试');
  assert.match(result.doneResults[0].htmlMessage, /↓ 下载/);
  assert.match(result.doneResults[0].htmlMessage, /4 路并发/);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.saved[0].key, 'loon-speedtest:lastResult');
  assert.equal(result.saved[0].value.state, 'ok');
  assert.equal(result.saved[0].value.runs.reduce((sum, run) => sum + run.completedBytes, 0), 4000000);
  assert.ok(result.requests.every(request => request.node === '节点 A' && request['binary-mode'] && request.alpn === 'h1' && request['auto-redirect'] === false && request.insecure === false));
});

test('没有节点上下文时给出可操作错误并不发请求', async () => {
  const result = await execute();
  assert.equal(result.requests.length, 0);
  assert.equal(result.doneCount, 1);
  assert.match(result.notifications[0][2], /未指定测速目标/);
  assert.equal(result.doneResults[0].title, '测速失败');
  assert.match(result.doneResults[0].htmlMessage, /未指定测速目标/);
});

test('查询字符串参数与节点入口兼容，可关闭通知', async () => {
  const result = await execute({ argument: 'mode=single&maxMB=4&notify=false', environment: { params: { node: '入口节点' } } });
  assert.equal(result.requests[0].node, '入口节点');
  assert.equal(result.notifications.length, 0);
  assert.match(result.doneResults[0].htmlMessage, /入口节点/);
  assert.equal(result.saved[0].value.state, 'ok');
});

test('存储与通知失败不影响脚本结束', async () => {
  const result = await execute({ argument: { node: 'DIRECT', maxMB: 4 }, storageThrows: true, notificationThrows: true });
  assert.equal(result.doneCount, 1);
  assert.ok(result.logs.some(line => line.includes('本地存储失败')));
  assert.equal(result.doneResults[0].title, '节点速度测试');
  assert.ok(result.doneResults[0].htmlMessage.length > 0);
});

test('Loon 未返回二进制时报告失败，不使用 Header 伪造下载量', async () => {
  const result = await execute({ argument: { node: 'DIRECT', maxMB: 4 }, dataType: 'string' });
  assert.equal(result.saved[0].value.state, 'failed');
  assert.equal(result.saved[0].value.runs[0].completedBytes, 0);
  assert.equal(result.requests.length, 1);
  assert.equal(result.doneResults[0].title, '节点速度测试 · 未完成');
  assert.match(result.doneResults[0].htmlMessage, /不是 Uint8Array/);
});

test('回调在兜底之后才到达时不重入、不追加比较轮次', async () => {
  const result = await execute({ argument: { node: 'DIRECT', mode: 'compare', maxMB: 4, duration: 3, requestTimeout: 1 }, delay: 10000 });
  assert.equal(result.doneCount, 1);
  assert.equal(result.saved[0].value.runs[0].state, 'incomplete');
  assert.equal(result.requests.length, 1);
  assert.match(result.doneResults[0].htmlMessage, /未按时回调/);
});

test('Apple 源通过 Loon HEAD 检查，再透传 Range 下载并展示结果', async () => {
  const result = await execute({ argument: { node: '节点 A', test_source: 'Apple CDN', mode: 'single', maxMB: 4 } });
  assert.equal(result.requests[0].method, 'HEAD');
  assert.equal(result.requests[0].headers.Range, undefined);
  assert.ok(result.requests.slice(1).every(request => request.method === 'GET' && request.headers.Range === 'bytes=0-999999'));
  assert.match(result.doneResults[0].htmlMessage, /Apple CDN/);
  assert.equal(result.saved[0].value.state, 'ok');
});

test('自定义源保留 test_url 的查询参数，不附加测速源私有参数', async () => {
  const url = 'https://downloads.example.com/test.bin?token=example';
  const result = await execute({ argument: { node: 'DIRECT', test_source: '自定义', test_url: url, maxMB: 4 } });
  assert.ok(result.requests.every(request => request.url === url));
  assert.match(result.doneResults[0].htmlMessage, /自定义/);
});

test('Loon 默认双向通过 POST 发送 Uint8Array，显式节点、超时、部分成功和结果均可用', async () => {
  const result=await execute({argument:{node:'节点 A',direction:'both',maxMB:4}});
  assert.equal(result.doneCount,1);
  assert.equal(result.saved[0].value.direction,'both');
  assert.deepEqual(Array.from(result.saved[0].value.runs,x=>x.direction),['download','upload']);
  const posts=result.requests.filter(x=>x.method==='POST');
  assert.ok(posts.length>0);
  assert.ok(posts.every(x=>Object.prototype.toString.call(x.body)==='[object Uint8Array]' && x.node==='节点 A' && x.timeout===10000 && x.headers['Content-Type']==='application/octet-stream'));
  assert.match(result.doneResults[0].htmlMessage,/↑ 上传/);
});

test('复现手机截图：Apple HEAD 无范围声明仍下载，CF 预热错误在弹窗显示真实 403',async()=>{
  const result=await execute({argument:{node:'测试节点',direction:'both',test_source:'Apple CDN',warmup:2,maxMB:4},reply:spec=>{
    if(spec.method==='HEAD')return {status:200,headers:{},binary:true,bytes:0};
    if(spec.method==='POST')return {status:403,headers:{},binary:true,bytes:0};
    return {status:206,headers:{'Content-Range':'bytes 0-'+(spec.bytes-1)+'/4294967296'},binary:true,bytes:spec.bytes};
  }});
  assert.equal(result.saved[0].value.state,'partial');
  assert.equal(result.saved[0].value.runs[0].state,'ok');
  assert.match(result.doneResults[0].htmlMessage,/预热失败 · 请求 #1：上传 HTTP 403/);
  assert.doesNotMatch(result.doneResults[0].htmlMessage,/未声明 Accept-Ranges/);
});


test('HTTPClient 回调对象错误保留具体说明及状态，不显示 object Object',async()=>{
  const r=await execute({argument:{node:'DIRECT',direction:'upload',warmup:2,maxMB:4},callbackError:{message:'连接被重置'}});
  assert.match(r.doneResults[0].htmlMessage,/预热失败 · 请求 #1：POST 请求失败：连接被重置（HTTP 502）/);
  assert.doesNotMatch(r.doneResults[0].htmlMessage,/object Object/);
});

test('Apple 上传二进制 JSON 回执经过真实适配层解析，双向均完成',async()=>{
  const r=await execute({argument:{node:'节点 A',direction:'both',test_source:'apple',upload_source:'apple',maxMB:4}});
  assert.equal(r.saved[0].value.state,'ok');
  assert.ok(r.saved[0].value.runs.every(x=>x.testSource==='apple' && x.completedBytes===2000000));
  assert.ok(r.requests.filter(x=>x.method==='POST').every(x=>x.url.endsWith('/slurp')));
});

test('Apple 上传字符串 JSON 回执可用，缺失、伪类型、损坏或过大回执拒绝计数',async()=>{
  for(const [data,ok] of [[JSON.stringify({Bytes:1000000}),true],['{"Bytes":"1000000"}',false],['not json',false],[' '.repeat(4097)+'{"Bytes":1000000}',false],['{}',false]]) {
    const r=await execute({argument:{node:'DIRECT',direction:'upload',upload_source:'apple',maxMB:4},reply:()=>({status:200,bytes:0,data})});
    assert.equal(r.saved[0].value.state,ok?'ok':'failed');
    if(!ok) assert.match(r.doneResults[0].htmlMessage,/Apple 上传字节回执不符/);
  }
});

test('对端关闭的弹窗显示短中文原因，日志与保存结果保留完整诊断',async()=>{
  const detail='Error Domain=LNGCDAsyncSocketErrorDomain Code=7 "Socket closed by remote peer" UserInfo={NSLocalizedDescription=Socket closed by remote peer}';
  const r=await execute({argument:{node:'DIRECT',direction:'upload',warmup:2,maxMB:4},callbackError:detail});
  assert.match(r.doneResults[0].htmlMessage,/预热失败 · 连接被对端关闭/);
  assert.doesNotMatch(r.doneResults[0].htmlMessage,/LNGCDAsyncSocketErrorDomain/);
  assert.match(r.saved[0].value.runs[0].warmup.errors[0],/LNGCDAsyncSocketErrorDomain/);
  assert.ok(r.logs.some(x=>x.includes(detail)));
});

test('节点协议在结果、日志与保存记录显示，节点信息不扩散且路由目标不变',async()=>{
  for(const direction of ['download','both']) {
    const environment={params:{node:'节点 A',nodeInfo:{name:'节点 A',type:'Hysteria2',address:'private.example',password:'private-token'}}};
    const r=await execute({argument:{node:'节点 A',direction,maxMB:4},environment});
    assert.equal(r.doneResults[0].title,'节点速度测试');
    assert.match(r.doneResults[0].htmlMessage,/协议 · Hysteria2/);
    assert.equal(r.saved[0].value.nodeProtocol,'Hysteria2');
    assert.ok(r.requests.every(x=>x.node==='节点 A'));
    assert.ok(r.logs.some(x=>x.includes('节点协议：Hysteria2')));
    assert.doesNotMatch(JSON.stringify([r.doneResults,r.saved,r.logs,r.notifications]),/private\.example|private-token/);
  }
});

test('显式覆盖节点或策略组不套用入口协议，未知协议仍正常测速，DIRECT 标直连',async()=>{
  const environment={params:{node:'节点 A',nodeInfo:{name:'节点 A',type:'Trojan'}}};
  for(const [node,label] of [['节点 B','未知'],['DIRECT','直连']]) {
    const r=await execute({argument:{node,maxMB:4},environment});
    assert.equal(r.saved[0].value.state,'ok');assert.match(r.doneResults[0].htmlMessage,new RegExp('协议 · '+label));
    assert.ok(r.requests.every(x=>x.node===node));
  }
  const r=await execute({argument:{maxMB:4},environment:{params:{policyGroup:'策略组',nodeInfo:{name:'实际节点',type:'Trojan'}}}});
  assert.match(r.doneResults[0].htmlMessage,/协议 · 未知/);assert.ok(r.requests.every(x=>x.node==='策略组'));
});

test('真实 Loon 适配层支持自动 H2、单路小块预热、有限 H1 恢复与独立上传块',async()=>{
 let firstPost=true;
 const r=await execute({argument:{node:'节点 A',adaptive:true,httpVersion:'auto',test_source:'apple',upload_source:'apple',warmup:2,direction:'both',duration:5,maxMB:8,uploadChunkKB:250},reply:s=>{
   if(s.method==='HEAD')return{status:200,bytes:0,headers:{}};
   if(s.method==='POST') {
     if(firstPost){firstPost=false;return new Error('Socket closed by remote peer');}
     return{status:200,bytes:48,uploadBytes:s.bytes};
   }
   return{status:206,binary:true,bytes:s.bytes,headers:{'Content-Range':'bytes 0-'+(s.bytes-1)+'/4294967296'}};
 }});
 assert.equal(r.doneCount,1);assert.equal(r.saved[0].value.state,'ok',JSON.stringify(r.saved[0].value));
 assert.ok(r.requests.some(x=>x.alpn==='h2'));assert.ok(r.requests.some(x=>x.alpn==='h1'));
 const up=r.saved[0].value.runs[1];assert.equal(up.recovered,true);assert.ok(up.totalScheduledBytes<=up.budgetBytes);
 assert.ok(r.requests.filter(x=>x.method==='POST').every(x=>x.body.byteLength<=250000 && x.node==='节点 A'));
 assert.ok(r.logs.some(x=>x.startsWith('参数 | ')));assert.match(r.doneResults[0].htmlMessage,/已降低负载重测/);
});
