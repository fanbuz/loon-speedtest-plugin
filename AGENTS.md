# Loon Speedtest

- 使用中文维护需求、设计和验证记录；以当前范围和当前证据为准。
- 代码是无第三方依赖的 JavaScript。`src/core.js` 在 Node 与 Loon 共用；`src/presentation.js` 生成离线结果页；`src/loon.js` 只处理 Loon API。
- 改代码后执行 `npm run check`（临时目录构建，不能改写发行文件）。`dist/` 必须由 `npm run build` 生成，默认固定为当前仓库的 GitHub Raw 地址；本地脚本需显式 `npm run build:local`。
- Generic 入口成功和失败都通过 `$done({title, htmlMessage})` 返回非空 HTML 结果页；渲染异常时降级为 `{title, content}`。动态内容必须转义，关闭通知不影响结果页。
- HEAD 不带 Range，允许正常的 200 并读取 Accept-Ranges 声明；真正 GET 分块仍须校验 206、Content-Range 和实际字节数。
- 预热和正式测量分别计时、排空在途；预热流量计入总预算但不能计入正式速度。两者的样本和耗时不能混算。
- 单路指 1 个在途请求，并发指 N 个在途请求；不能把它们宣称为已验证的独立 TCP 连接。
- 请求完成回调不能代表逐秒真实流量。禁止将完成回调桶称为实时速度、峰值或准确中位数。
- 使用真实二进制响应长度核算数据，禁止用 Content-Length 替代实际下载量。
- 所有请求显式传入 node；没有目标时应报错，不默认测直连。不得改全局代理模式或策略组选择。
- 达到时长后停止发新请求，等待在途请求结束；比较模式必须等上一阶段完全结束。异常不重试。
- 未经过 Loon 真机的结果标为待验证。Mac 直连冒烟不能作为代理节点测速验收。
- 默认不启用 Superpowers；仅当前请求明确要求时使用。
