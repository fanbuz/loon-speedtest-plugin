# v0.5.0 验证

日期：2026-11-03。最低兼容目标为 Loon 3.2.1（745）。本版完成自动化、发行脚本模拟、本地 HTTP 和 macOS 原生富文本验证；Loon 真机仍待验证。

## 自动化与发行一致性

`npm run build` 生成默认 GitHub Raw 发行文件；`npm run check` 通过 135 项测试、默认/本地临时构建语法、dist 三个文件逐字节一致性与 README 安装缓存版本检查。检查本身不改写 dist。

隔离副本覆盖修改源码、插件、脚本、图标、删除产物、README 版本不匹配等负例；均按预期失败且不覆盖发行文件，临时目录清理通过。只改变 package.json 的 version/releaseDate，Node 与 Loon VM 的日志、结果、插件日期和缓存键同步；重复构建相同，非法元数据在生成前拒绝。

行为回归包括：

- HEAD/GET/POST 经实际适配层包装后，证书、全部 DNS、未知混合消息、校验错误及禁止 HTTP 状态不触发恢复；明确超时、连接重置/对端关闭、H2/ALPN 兼容错误与 502/503/504 受每方向一次上限约束。
- HEAD 重试占用本方向恢复额度；恢复尝试后仍失败不能标记 recovered。未回调停止后续测量，晚回调不能改写已保存结果。
- 所有尝试计预算；预热、失败阶段及成功重测分别计时，不混入成功均值。Range GET 与 Apple Bytes 回执、真实二进制长度和上传请求体计数保持校验。
- AnyTLS 大小写及 JSON/对象输入、缺省/损坏/名称不匹配/未知类型原因；禁止读取敏感 getter，未记录整个 nodeInfo。未知原因仅日志可见。
- 配置 A 与入口 B 冲突时请求仍走 A，HTML/通知仅增加一行提示，不套用 B 协议；一致时没有额外提示。特殊字符转义、禁用通知仍显示结果、单次 $done 与渲染失败降级继续通过。
- 2→1、4→2、无降载、双向仅一项降载及 compare 的所选模式和实际并发均可辨认。H1/H2 仅标记请求配置，不冒充协商协议或 TCP 连接数。
- 旧版入口的 17 项命名参数、字符串数值/布尔、特殊字符及完整双向流程继续回归。VM 不代表旧版 Loon 实机。

## 集成验收

直接执行生成的 `dist/loon-speedtest.js`，在不提供 require/module 和外部元数据的 VM 中完成 15 次流程：正常 AnyTLS、敏感字段隔离、配置冲突、三种拒绝恢复原因分别覆盖 HEAD/GET/POST、正式阶段单次恢复、持续失败、固定模式不重试、未知在途停止。每次核对路由、预算、版本、非空 HTML、单次 $done 和晚回调不改结果；均通过。

请求构造重构以 `30d0b60` 为行为基线，340 组相同输入覆盖三种方向/模式/源、固定与自适应、预热开关、HTTP 配置和异常；请求全字段、请求体 SHA256、完整结果、日志和调度逐项一致。

`npm run smoke -- --local --omit-accept-ranges` 通过：本地真实 HTTP HEAD 缺少 Accept-Ranges，实际 Range GET 校验成功；POST 服务端完整接收并返回 Bytes，双向 single/4 路及独立预热完成，总请求数据不超过 4 MB。回环速度没有实际网络意义，不是代理节点验收。本版未重复 Apple/CF 远端测速；历史远端结果不作为本版运行证明。

## 原生显示

`node scripts/preview.mjs /tmp/loon-v050-previews` 生成七类样例，经 macOS NSAttributedString HTML 导入后检查并渲染浅/深背景预览。300 pt 内容宽度下：单路 219 pt、对比 291 pt、降载 246 pt、冲突 246 pt、部分失败 233 pt、未回调 211 pt、启动错误 79 pt。全部无背景色属性、无 Times 字体回退；提示未遮挡双向速度和失败原因。这是 macOS 富文本证据，不是 Loon iOS 截图。

## 待 Loon 真机验证

按 [TESTING.md](TESTING.md) 保留以下待办，不影响已验证代码与文案发布，也不标为已通过：

- 3.2.1（745）及当前版安装、修改参数生效、通知/结果显示与指定节点双向测速。
- 当前版 AnyTLS 入口的实际 name/type，用户截图对应节点的未知原因。
- 同设备/同节点/同源/同预算的 H1/H2 对照；实际协商协议和连接数无证据时标不可观测。
- 原生弹窗中的配置冲突、降载模式、未回调和具体失败原因。

对应 [#3](https://github.com/fanbuz/loon-speedtest-plugin/issues/3)、[#5](https://github.com/fanbuz/loon-speedtest-plugin/issues/5)、[#9](https://github.com/fanbuz/loon-speedtest-plugin/issues/9) 保留真机验证待办。未新增独立发版/真机验收 issue。
