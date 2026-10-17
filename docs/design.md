# 测速设计与选型

## 已确认的事实

截图直接显示 Apple URL `https://mensura.cdn-apple.com/api/v1/gm/large`、并发 4、最长 10 秒。只能据此确认图中这一轮使用的端点；无法从截图确认 App 的完整实现或是否也支持 Cloudflare。

v0.1.1 默认使用 Cloudflare 的 `__down?bytes=N`，也支持 Apple CDN 和自定义。仅自定义读取 test_url。Apple 端点实际验证返回总大小 4 GB，HEAD 与 GET Range 均正确返回请求的 64 KB，故必须按块读取。两个 Range 源在正文下载前先校验 HEAD 206 与 Content-Range；每次 GET 也校验范围及真实字节数。

## 模块

```text
Loon Generic / 插件参数
       ↓
src/loon.js：参数、显式 node、HTTP/HEAD 回调、结果对象、通知、本地结果
       ↓
src/core.js：校验、并发调度、预算、时间、结果统计
       ↓
$httpClient.head/get → 指定节点 → Cloudflare / Apple / 自定义
```

构建脚本只拼接两段源码，不引入运行时依赖。Node 测试和冒烟工具使用同一核心算法，分别注入模拟调度器和真实 HTTP 客户端；它们不能替代 Loon 真机测试。

## 调度和统计口径

1. 调度前同步扣除请求数据预算；尾块缩小；失败不退预算且不重试。
2. 单路最多 1 个在途请求，并发最多 N 个。每个 worker 完成后检查停止条件再继续。
3. 到发请求窗口边界停止新增请求，并等待在途请求回调。记录真实 elapsedMs。
4. compare 将总预算均分，完整排空第一轮后才开始第二轮；任何一轮失败就不再继续。
5. 仅 HTTP 200 且真实 Uint8Array 长度等于请求大小的响应作为成功样本。出现错误则整轮不给有效速度，保留已确认数据和错误。
6. 统一使用 `总成功字节 × 1000 / elapsedMs`，不相加单请求耗时，不以完成回调构造虚假的逐秒流量。
7. 回调在窗口加请求超时再加 1 秒后仍缺失，则标 incomplete、记录 unresolvedRequests、不继续比较、结束脚本；不承诺底层请求已被主动取消。

默认每块 1 MB、4 路并发；本轮在途响应数据规模约 4 MB（运行时复制和 Loon 本身的开销另计）。每块与并发上限是参数约束，不保证所有机型都可承受最高配置。

## 路由与能力边界

优先使用用户显式 node，再取文档中类型明确的 `params.node` / `params.policyGroup`。nodeInfo 只有“节点简要信息”的公开说明，没有字段契约，因此第一版依赖显式配置，不猜 name 字段。

每个请求都带 node，脚本不修改策略组或全局模式。若目标是自动切换或负载均衡策略组，测速期间的实际出口仍可能变化；需要 Loon 连接记录验收。

Loon 暴露的是完整请求结束回调，没有公开的流式进度和主动取消句柄。使用 HTTP/1.1 只约束协议选项，不能证明代理层和底层 TCP 连接独立。分块算法包含每次请求的等待，与 Cloudflare SDK 通过浏览器 PerformanceResourceTiming 计算的速度不同。

## 一手资料（2026-10-17 核对）

- [Loon Script API](https://nsloon.app/docs/Script/script_api/)：HTTP、node、binary-mode、timeout、定时器、通知、本地存储、运行上下文。
- [Loon Script](https://nsloon.app/docs/Script/script_v2/)：3.5.1 (983)+ 的 Generic、新语法和参数传递。
- [Loon 插件](https://nsloon.app/docs/Plugin/)：Argument 控件和插件最低版本。
- [Cloudflare Speedtest 官方源码说明](https://github.com/cloudflare/speedtest)：下载端点、浏览器计时依赖与测量配置。

待验证：实际安装版本、新插件语法、参数控件、HTTP 路由和 h1 行为、设备资源限制、超时回调、通知、缓存更新。没有把“接口文档支持”标为“真机已通过”。

## 展示与分发

Generic 成功与失败均通过 `$done({title, content})` 返回非空摘要，和日志、通知分开。默认构建固定为当前仓库 GitHub Raw 的 dist 目录；可用 --base-url 覆盖；本地脚本引用必须显式 --local。检查命令使用临时构建目录，避免把远端安装包覆盖成本地引用。图标随构建复制到 dist/icon.png，并写入插件 #!icon。
