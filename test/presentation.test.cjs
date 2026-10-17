const { test } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../src/presentation.js');
function fixture() {
  const run={ state:'ok',concurrency:1,completedBytes:18000000,elapsedMs:10375,bytesPerSecond:18000000/10.375,errors:[],warnings:[],totalCompletedBytes:22000000,totalElapsedMs:12475 };
  return { node:'示例节点 · US',direction:'both',mode:'single',state:'ok',testSource:'cf',runs:[{...run,direction:'download',testSource:'apple'},{...run,direction:'upload',testSource:'cf',bytesPerSecond:2500000}] };
}
test('原生弹窗使用紧凑双向指标与来源，没有背景色或浏览器布局依赖',()=>{
  const html=view.render(fixture());
  assert.match(html,/>13\.88<\/span>/);
  assert.match(html,/>20\.00<\/span>/);
  assert.match(html,/↓ 下载  ·  Apple CDN/);
  assert.match(html,/↑ 上传  ·  Cloudflare/);
  assert.match(html,/24\.9 秒 · 44\.0 MB/);
  assert.doesNotMatch(html,/<style|class=|background|grid|flex|var\(|正式平均|在途收尾|LOON \/ SPEEDTEST/i);
});
test('节点与失败错误转义，无脚本、图片或外部依赖',()=>{
  const result=fixture();result.node='<img src=x onerror="alert(1)">';
  result.runs[1]={...result.runs[1],state:'failed',bytesPerSecond:null,errors:['<script>x</script>']};
  const html=view.render(result);
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script|<img|<iframe|https?:\/\//i);
  assert.doesNotMatch(html,/>20\.00<\/span>/);
  assert.match(html,/>13\.88<\/span>/);
  assert.match(view.error('HEAD <200>'),/HEAD &lt;200&gt;/);
});
test('比较模式每个方向分别显示单路和并发，未开始项不伪造速度',()=>{
  const result=fixture();result.mode='compare';result.runs.splice(1,0,{...result.runs[0],concurrency:4});
  const html=view.render(result);assert.match(html,/4 路并发/);assert.match(html,/单路 \/ 并发对比/);
  result.runs=result.runs.slice(0,1);
  assert.match(view.render(result),/↑ 上传 · 未开始/);
});
