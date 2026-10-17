# 测速实现参考

核对日期：2026-10-17。借鉴方法并自行实现，不复制第三方源码。

| 一手资料 | 可借鉴内容 | Loon 中的处理 |
| --- | --- | --- |
| [Surge 官方 Throughput Test 发布说明](https://nssurge.com/support/mac/release-notes/)（6.4.4） | 下载/上传分别设置 URL、并发和时长；官方默认并发 4、窗口 10 秒 | 保留用户选择源与模式，分离上传块上限；没有公开依据声称复刻其内部算法 |
| [Surge CLI](https://manual.nssurge.com/tools/cli.html) | 内置 test-policy-bandwidth | 属于 Surge 自身能力，本项目不调用它，也不假定 Loon 提供相同原生接口 |
| [LibreSpeed Worker](https://github.com/librespeed/speedtest/blob/master/speedtest_worker.js) / [文档](https://github.com/librespeed/speedtest/blob/master/doc.md) | 预热、错峰多流、按方向配置、失败处理 | 独立实现小块串行预热、150ms 错峰；不移植 XHR onprogress / abort 或无上限流恢复；不导入 LGPL 源码 |
| [Cloudflare 官方引擎](https://github.com/cloudflare/speedtest) | 递增请求大小、浏览器精细计时、带宽分位数 | 借鉴递增负载；不把 Loon 完成回调当逐秒流量，也不直接对每个并发请求的速率取 P90 来冒充整条线路带宽 |
| [Apple 服务协议](https://github.com/network-quality/server/blob/main/SERVER_SPEC.md) / [官方配置](https://mensura.cdn-apple.com/api/v1/gm/config) | HTTP/2、独立下载/上传端点 | HTTPS 默认优先 H2；保留 H1 兼容，Apple 上传校验 Bytes |
| [Loon Script API](https://nsloon.app/docs/Script/script_api/) | Uint8Array、node、毫秒 timeout、alpn h1/h2、完成回调 | 使用公开接口；没有逐字节进度和逐请求取消接口，未回调时不能把底层请求假装取消后继续下一阶段 |

## 两份用户日志对应的回归边界

v0.3.0 第一份：Apple 下载成功 28 MB / 17.59 秒，上传预热 4 个 1 MB 请求中 1 个成功、3 个原生超时。第二份：下载预热成功 7 MB，但仍有请求未回调，13.05 秒时兜底退出。两份均通过 HEAD 200 缺少范围声明的检查。

自动化分别构造“较大上传块超时”和“较大并发预热丢失回调”的负载模型，确认小块预热与有限恢复可改善这两种模型；这不是对用户链路根因的重建，也不能证明用户真机已修复。无条件丢失回调的模型仍必须停止，并显示已确认数据及未回调数量。

## 统计边界

结果依旧是成功正式阶段的确认字节 / 实际墙钟，包含等待和收尾。不把十秒内尚未完成的块全算入十秒，也不乘经验补偿系数去贴网页。Apple 与 CF 是不同服务器，不能直接要求相同结果；与 CF 网页对照时需统一节点、网络、来源、时段，并保留方法差异。
