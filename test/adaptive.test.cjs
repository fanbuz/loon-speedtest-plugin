const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/core.js');
const harness=require('./harness.cjs');
const options=extra=>core.normalizeOptions({node:'测试节点',direction:'both',mode:'concurrent',duration:5,warmup:2,maxMB:16,chunkKB:1000,...extra});
function reply(spec) {
 if(spec.method==='HEAD') return{status:200,headers:{'Content-Length':'4294967296'}};
 return{status:spec.method==='POST'||!spec.headers.Range?200:206,binary:true,bytes:spec.method==='POST'?42:spec.bytes,uploadBytes:spec.method==='POST'?spec.bytes:undefined,headers:spec.headers.Range?{'Content-Range':'bytes 0-'+(spec.bytes-1)+'/4294967296'}:{}};
}

test('默认自适应、自动 HTTP、下载上传独立上限，拒绝无效开关',()=>{
 const o=core.normalizeOptions();assert.equal(o.adaptive,true);assert.equal(o.httpVersion,'auto');assert.equal(o.chunkBytes,4000000);assert.equal(o.uploadChunkBytes,1000000);
 assert.equal(core.normalizeOptions({adaptive:'false'}).adaptive,false);
 for(const extra of [{adaptive:'yes'},{httpVersion:'h3'},{uploadChunkKB:0}])assert.throws(()=>core.normalizeOptions(extra));
});

test('双向四轮预热均单路从 64 KB 起，阶段排空、总预算含预热且无重叠',async()=>{
 const h=harness({delay:s=>s.method==='HEAD'?10:100+s.bytes/2000,reply});
 const o=options({mode:'compare'});const r=await h.settle(core.run(o,h.runtime));
 assert.equal(r.state,'ok');assert.equal(r.runs.length,4);
 assert.ok(h.calls.filter(s=>s.phase==='warmup').every(s=>s.worker===0 && s.bytes<=256000));
 for(const run of r.runs){assert.equal(run.warmup.concurrency,1);assert.equal(run.warmup.requestReports[0].bytes,64000);assert.ok(run.warmup.scheduledBytes<=1000000);assert.ok(run.totalScheduledBytes<=run.budgetBytes);}
 assert.ok(h.calls.reduce((n,s)=>n+s.bytes,0)<=o.maxBytes);assert.ok(h.peak<=4);
 for(let i=1;i<r.runs.length;i++)assert.ok(r.runs[i].warmup.startedAt>=r.runs[i-1].startedAt+r.runs[i-1].elapsedMs);
});

test('并发错峰启动、动态分块有增有减，均值使用共同墙钟而不是累计请求耗时',async()=>{
 const h=harness({delay:s=>200+s.bytes/500,reply});
 const r=await h.settle(core.run(options({direction:'download',warmup:0,maxMB:32}),h.runtime));
 const calls=h.calls.filter(s=>s.method==='GET');assert.equal(r.state,'ok');assert.ok(new Set(calls.map(s=>s.bytes)).size>2);
 assert.ok(calls.filter(s=>s.requestId<=4).some(s=>s.start>=150));
 const run=r.runs[0];assert.equal(run.bytesPerSecond,run.completedBytes*1000/run.elapsedMs);
 assert.ok(run.requestReports.every(x=>x.state==='ok'&&x.elapsedMs>0));assert.ok(calls.every(x=>x.bytes<=1000000));
 assert.ok(run.drainMs<1000);
});

test('按第一份日志建模：1 MB 上传块超时，稳健模式恢复为更小块与较低并发，失败数据不混入速度',async()=>{
 const h=harness({delay:s=>s.method==='HEAD'?5:s.phase==='measurement'&&s.method==='POST'&&s.bytes>256000?500:50+s.bytes/5000,reply:s=>s.phase==='measurement'&&s.method==='POST'&&s.bytes>256000?new Error('Request timeout.'):reply(s)});
 const o=options({duration:10,maxMB:32});const r=await h.settle(core.run(o,h.runtime));
 assert.equal(r.state,'ok');const up=r.runs.find(x=>x.direction==='upload');assert.equal(up.recovered,true);assert.equal(up.discardedPhases.length,1);assert.equal(up.concurrency,2);assert.equal(up.alpn,'h1');
 assert.ok(up.requestReports.every(x=>x.bytes<=256000));assert.ok(up.discardedPhases[0].errors.length>0);
 assert.equal(up.bytesPerSecond,up.completedBytes*1000/up.elapsedMs);assert.ok(up.totalScheduledBytes>up.scheduledBytes+up.warmup.scheduledBytes);
 assert.ok(h.calls.reduce((n,s)=>n+s.bytes,0)<=o.maxBytes);
 const firstNew=up.startedAt;assert.ok(firstNew>=up.discardedPhases[0].startedAt+up.discardedPhases[0].elapsedMs);
});

test('预热明确超时后只作一次 16 KB 单路恢复，原阶段数据保留总量、不计正式均值',async()=>{
 let failed=false;
 const h=harness({delay:100,reply:s=>{if(s.phase==='warmup'&&!failed){failed=true;return new Error('Socket closed by remote peer');}return reply(s);}});
 const r=await h.settle(core.run(options({direction:'download'}),h.runtime));const run=r.runs[0];
 assert.equal(r.state,'ok');assert.equal(run.recovered,true);assert.equal(run.discardedPhases.length,1);assert.equal(run.warmup.scheduledBytes,16000);assert.equal(run.alpn,'h1');
 assert.equal(run.totalScheduledBytes,run.scheduledBytes+run.warmup.scheduledBytes+run.discardedPhases[0].scheduledBytes);
 assert.equal(run.totalCompletedBytes,run.completedBytes+run.warmup.completedBytes+run.discardedPhases[0].completedBytes);
});

test('按第二份日志负载建模：只在大块并发预热丢失回调；小块串行预热避免该负载',async()=>{
 const make=()=>harness({delay:100,reply:s=>s.phase==='warmup'&&s.bytes===1000000&&s.worker===3?new Promise(()=>{}):reply(s)});
 const old=make();const failed=await old.settle(core.run(options({adaptive:false,maxMB:64}),old.runtime));assert.equal(failed.state,'failed');assert.ok(failed.runs[0].warmup.unresolvedRequests>0);
 const modern=make();const ok=await modern.settle(core.run(options({maxMB:64}),modern.runtime));assert.equal(ok.state,'ok');
});

test('任何负载下真实未回调均不能伪造成功、恢复或启动上传，晚回调不改变已返回结果',async()=>{
 let delayed=false;
 const h=harness({delay:s=>s.method==='HEAD'?10:delayed?12000:100,reply:s=>{if(s.phase==='warmup'){delayed=true;return new Promise(()=>{});}return reply(s);}});
 const r=await h.settle(core.run(options({requestTimeout:1}),h.runtime));assert.equal(r.state,'failed');assert.equal(r.runs.length,1);assert.equal(r.runs[0].bytesPerSecond,null);assert.equal(r.runs[0].warmup.unresolvedRequests,1);assert.ok(!h.calls.some(x=>x.method==='POST'));
 const before=JSON.stringify(r);await h.drain();assert.equal(JSON.stringify(r),before);
 const late=harness({delay:s=>s.method==='HEAD'?0:3000,reply});
 const stopped=await late.settle(core.run(options({requestTimeout:1}),late.runtime));const snapshot=JSON.stringify(stopped);
 await late.drain();assert.equal(JSON.stringify(stopped),snapshot);assert.ok(!late.calls.some(x=>x.method==='POST'));
});

test('恢复次数按方向有硬上限；持续连接错误不循环重试',async()=>{
 const h=harness({delay:100,reply:s=>s.method==='HEAD'?reply(s):new Error('Request timeout.')});
 const r=await h.settle(core.run(options({direction:'download'}),h.runtime));assert.equal(r.state,'failed');assert.equal(h.calls.filter(s=>s.method==='GET').length,2);assert.equal(r.runs[0].discardedPhases.length,1);
});

for(const status of [403,429])test('HTTP '+status+' 不执行恢复、不更换源',async()=>{
 const h=harness({reply:s=>s.method==='HEAD'?reply(s):{status}});const r=await h.settle(core.run(options({direction:'download'}),h.runtime));
 assert.equal(r.state,'failed');assert.equal(h.calls.filter(s=>s.method==='GET').length,1);
});

test('非法 Range 或 Apple Bytes 回执不作为瞬时故障恢复',async()=>{
 for(const direction of ['download','upload']){
  const h=harness({reply:s=>s.method==='HEAD'?reply(s):direction==='download'?{status:200,binary:true,bytes:s.bytes}:{status:200,uploadBytes:s.bytes-1}});
  const r=await h.settle(core.run(options({direction}),h.runtime));assert.equal(r.state,'failed');assert.equal(h.calls.filter(s=>s.method!=='HEAD').length,1);
 }
});

test('HEAD 明确的 H2 网络失败可一次回退 H1；未回调不回退，显式 h2 不切版本',async()=>{
 for(const httpVersion of ['auto','h2']) {
  let first=true;const h=harness({delay:100,reply:s=>{if(s.method==='HEAD'&&first){first=false;return new Error('Network reset');}return reply(s);}});
  const r=await h.settle(core.run(options({httpVersion,direction:'both'}),h.runtime));assert.equal(r.state,'ok');
  assert.equal(h.calls[0].alpn,'h2');assert.equal(h.calls[1].alpn,httpVersion==='auto'?'h1':'h2');
 }
 const h=harness({hang:true});const r=await h.settle(core.run(options(),h.runtime));assert.equal(r.runs.length,1);assert.equal(h.calls.length,1);
});

test('上传分块上限独立于下载上限，POST 真实体长度始终与预算请求字节一致',async()=>{
 const h=harness({delay:30,reply});const r=await h.settle(core.run(options({direction:'upload',chunkKB:64,uploadChunkKB:1000,warmup:0}),h.runtime));
 assert.equal(r.state,'ok');assert.ok(h.calls.every(s=>s.body.byteLength===s.bytes));assert.ok(h.calls.some(s=>s.bytes>64000));
});

test('高时延快速线路不会困在小块固定点，逐步提高有效载荷且不伪造带宽',async()=>{
 const h=harness({delay:s=>s.method==='HEAD'?20:500+s.bytes/100000,reply});
 const r=await h.settle(core.run(options({direction:'download',mode:'single',duration:10,maxMB:128,chunkKB:4000}),h.runtime));
 assert.equal(r.state,'ok');assert.ok(h.calls.some(s=>s.phase==='measurement'&&s.bytes>=1000000));
 const run=r.runs[0];assert.equal(run.bytesPerSecond,run.completedBytes*1000/run.elapsedMs);assert.ok(run.drainMs<1500);
});

test('比较两轮的 HTTP 版本改变时不公布混合条件下的并发倍数',async()=>{
 let failed=false;
 const h=harness({delay:200,reply:s=>{if(s.phase==='measurement'&&s.worker===3&&!failed){failed=true;return new Error('Connection reset');}return reply(s);}});
 const r=await h.settle(core.run(options({direction:'download',mode:'compare',duration:5,maxMB:64}),h.runtime));
 assert.equal(r.state,'ok');assert.equal(r.runs[0].alpn,'h2');assert.equal(r.runs[1].alpn,'h1');assert.equal(r.runs[1].concurrency,2);assert.equal(r.comparisonRatio,null);
});

test('实测 CF 的 HTTP2 Protocol error 属于明确传输失败，可一次回退 H1',async()=>{
 const h=harness({delay:100,reply:s=>s.alpn==='h2'?new Error('Protocol error'):reply(s)});
 const r=await h.settle(core.run(options({direction:'download',test_source:'cf'}),h.runtime));
 assert.equal(r.state,'ok');assert.equal(h.calls[0].alpn,'h2');assert.equal(h.calls[1].alpn,'h1');assert.equal(r.runs[0].recovered,true);
 assert.equal(r.runs[0].discardedPhases[0].requestReports[0].errorKind,'protocol');
});

test('八路自适应限制同时完整响应的分块载荷，避免 N 个大块一起驻留',async()=>{
 const h=harness({delay:200,reply});const r=await h.settle(core.run(options({direction:'download',concurrency:8,chunkKB:4000,duration:5,maxMB:128}),h.runtime));
 assert.equal(r.state,'ok');assert.ok(h.peak<=8);assert.ok(h.calls.filter(s=>s.phase==='measurement').every(s=>s.bytes<=500000));
});
