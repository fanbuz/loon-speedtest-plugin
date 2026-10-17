# Loon 版本兼容

最低兼容目标：**3.2.1（745）**。插件元数据按此设置，旧版真机尚待确认；自动化通过不代表已经在该版安装运行。

## 选择依据

3.2.1（745）是 App Store 正式版，保留控件参数、HTTP/2、二进制请求与节点 Generic 上下文。相比最早支持参数的测试 Build，已包含参数修改生效及脚本异常终止等修复。无需为本项目使用的 API 强制要求 3.5.1（983）。不再往前压最低版本，避免退回更早的参数存储机制或额外维护分支。

| 功能 | 官方依据与本项目处理 |
| --- | --- |
| 插件参数 | [官方旧版 Demo](https://github.com/Loon0x00/LoonExampleConfig/blob/master/Plugin/Plugin_Arg.plugin) 与 [读取示例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/Script/plugin_arg.js)：`argument=[{参数名},...]` 在脚本中提供 `$argument.参数名`；保留全部 17 项控件，省略新版 type 声明，核心接受并校验字符串数值和布尔值 |
| 脚本入口 | [官方旧语法](https://nsloon.app/docs/Script/)：`generic script-path=...`、`argument`、`img-url`；本次移除从 983 才支持的新入口语法 |
| HTTP/2 | [Script API](https://nsloon.app/docs/Script/script_api/)：alpn h1/h2 从 Build 715 起支持；auto / h1 / h2 不变 |
| 二进制与路由 | 同一 Script API 文档，以及 [旧 API 文档](https://github.com/Loon0x00/LoonManual/blob/master/docs/cn/script_api.md)：Uint8Array、binary-mode、显式 node、毫秒 timeout、禁用重定向和 Cookie；不依赖 988 新增 API |
| 节点协议与结果 | [官方 Generic 示例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/Script/generic_example.js)：nodeInfo.name/type 与 htmlMessage；信息缺失显示未知 |
| 正式版与修复 | [官方 745 发布公告](https://t.me/LoonNews/1454)，以及 [同期记录](https://t.me/s/LoonNews?before=1460)：738 修复插件版本信息导致脚本不运行，744 修复参数修改后脚本引用更新问题，745 发布正式版 |

命名绑定由 Loon 传值，不把用户内容拼入查询字符串或 JSON。含 `&`、`+`、`%`、逗号及引号的节点名/URL 不应被脚本再次解码或拆分。代码继续兼容对象、JSON 和查询字符串的手工脚本参数。

## 验证状态

99 项自动化及构建检查通过。旧版绑定、控件定义和全部引用逐一检查；VM 测试覆盖字符串参数、自定义 URL、双向 single/concurrent 四轮、协议展示与一次 $done。测速核心除发行版本字段外未改变。

待真机：分别在 3.2.1（745）和当前版确认安装、控件修改即时生效、URL/节点名原样传递、H2/H1、二进制上传及结果显示。使用当前版的用户无需主动降级 App。反馈附日志开头的实际 Loon 版本。
