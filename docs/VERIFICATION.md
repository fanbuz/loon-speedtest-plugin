# v0.2.1 验证

日期：2026-10-17。新版 Loon iOS 回归待完成。

## 本次修复

手机截图显示 Apple HEAD 200 未带 Accept-Ranges，v0.2.0 因此在任何 GET 之前误拒绝。RFC 9110 §14.3 明确允许未收到该声明时发 Range；现在普通 HEAD 200 缺省声明可继续实际 GET 206 / Content-Range / 长度校验，显式 none 则停止。

上传错误被“预热未完成”遮挡是独立的展示缺陷；新版优先展示 warmup.errors，保留 HTTPClient 对象错误和响应状态。默认超时改为 10 秒；不能从已有截图确定 CF 上传失败的具体原因。iOS 截图仍出现衬线回退，改为显式 Helvetica face。

## 自动化与流程

64 项自动化测试和构建语法通过。新增覆盖缺少范围声明的 Apple/自定义 GET 成功、GET 200 拒绝、显式 none、完整模拟 Loon 的 Apple 成功/CF 403 部分结果、预热具体错误及对象错误详情。

本地 HTTP 服务故意省略 HEAD 的 Accept-Ranges，仍正确提供 GET 206 并完整读取 POST，用于完整复现此故障；真实 Apple 与 CF 流程的结果记录在发布工作记录中。Mac 网络和模拟接口不代表已验收用户手机节点。

## 协议依据

[HTTP Semantics §14.3 Accept-Ranges](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.3)。该声明可缺省，也不能保证后续服务器一定返回分段响应，所以仍严格检查实际 GET。没有对失败请求做重试或主动切整文件。

---

# v0.2.0 历史验证

日期：2026-10-17。Loon 真机回归待完成。

## 自动化

59 项测试及构建/语法检查通过，保留原有下载、Range、真实响应长度、超时、预热与字节预算回归。新增覆盖：

- 默认双向及单独上传参数；CF / Apple 预设忽略自定义字段，自定义 POST URL 保留查询参数。
- 上传发送非零 Uint8Array，以成功请求体而非空响应计数，不做 HEAD 或 Range。
- 下载和上传分别预热、统一各自墙钟，双向 compare 四轮总预算不超发，阶段不重叠。
- 某项失败保留成功项；未回调的测量、预热、HEAD 均不启动后续方向。
- 模拟 Loon API 实际调用 post，body 类型、node、毫秒超时和仅结束一次正确。
- 双向/对比/失败紧凑富文本，HTML 转义，无背景色、CSS 变量、grid/flex、外部资源。

## 真实请求

| 检查 | 结果 |
| --- | --- |
| CF 下载 + 上传 compare | 单路与 4 路、各自预热全部成功；总预算 4 MB，实际成功正文约 3.5 MB |
| CF 上传协议 | POST 65536 B 得到 HTTP 200，响应为空；上传量按请求体计算 |
| 本地完整流程 | 服务端完整读取 POST 并核对 Content-Length，再返回 200；双向四轮和预热成功，总量 4 MB |
| Apple 下载 + CF 上传 | 普通 HEAD / Range GET 与 POST 四轮及各自预热全部成功；实际成功正文约 3.75 MB，预算 4 MB |

CF 初次使用默认 Python User-Agent 的上传请求得到 403；使用浏览器兼容 User-Agent 与 Origin 得到 200。实现对 CF POST 采用后者，并已由 Node 完整流程验证。

Mac 使用系统网络，DIRECT 是工具标签；不代表已验证 Loon 节点或线路带宽。短预算冒烟只验证流程，不能用于测速性能结论。

## 原生显示

用户 v0.1.2 真机截图出现白底文字碎块、布局丢失和数字过大，证明原浏览器预览不能作为弹窗验收。新实现去掉整个 style 块、背景、类选择器及网页布局，只保留内联富文本和段落。

使用 macOS NSAttributedString HTML 原生导入并渲染检查：默认双向内容高度约 204 pt，没有任何 backgroundColor 属性。浅深底色、compare、错误与长节点名由同一原生排版器检查。该验证比浏览器检查更接近富文本能力，但不是 Loon iOS 实际渲染证明。

## 分发

README 顶部居中图标、名称、版本/构建/MIT/Loon 徽标和一键导入按钮。按钮指向带 v0.2.0 的完整 Raw 插件地址；新版 Generic 名称为「速度测试」，脚本版本 v0.2.0，超时 300 秒。

发布时检查 GitHub 渲染链接、徽标和 Raw 文件一致性；真机验收见 TESTING.md。
