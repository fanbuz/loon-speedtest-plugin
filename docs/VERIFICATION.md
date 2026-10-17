# v0.3.1 验证

日期：2026-10-17。新版 Loon 真机回归待完成。

## 当前改动与验证

工具名称统一为「节点速度测试」，覆盖插件、菜单、结果、日志与通知，以及 README / 安装按钮。结果在节点名称下以小字展示节点配置协议；DIRECT 显示直连。

使用 Loon 官方 generic_example.js 的 name/type 字段。必须与实际测速目标匹配，缺少、未知或不匹配时显示“协议 · 未知”；不从节点名猜测，不改变 node 路由，不增加联网请求，也不复制完整 nodeInfo。

78 项自动化及构建检查通过。新增覆盖官方 VMess 示例字段与常见别名、JSON 字符串兼容、显式目标覆盖、策略组、损坏/未知元数据、DIRECT、单方向与双向的结果保存/日志传递、隐私字段不扩散和 HTML 转义。原有下载上传、预热和预算回归仍通过。

macOS NSAttributedString 原生富文本预览检查通过：默认双向内容高度 219 pt，无背景色属性，浅/深底可读；实际 Loon iOS 节点信息类型、协议名称和未知状态仍需按 TESTING.md 回归。测速协议与调度未改动，沿用下方 v0.3.0 的端点冒烟证据，本次不重复消耗远端测速流量。

依据：[Loon 官方节点信息示例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/Script/generic_example.js)。


端点与调度的既有证据：[v0.3.0 验证记录](https://github.com/fanbuz/loon-speedtest-plugin/blob/v0.3.0/docs/VERIFICATION.md)。
