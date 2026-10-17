# 能力：Loon 单路与并发下载测速 v0.1.2

当前状态：功能和开发验证完成，待 Loon 真机回归验收。

## 目标与范围

手动指定节点，以单路、N 路并发或顺序对比模式得到平均下载速度和数据量。测速源下拉选择 Cloudflare（默认）、Apple CDN 或自定义；只有自定义才使用 test_url。HTML 结果页、日志和可选通知分别可用；默认先预热，再统计正式速度。

包含脚本、插件、图标、GitHub Raw 分发和 MIT 协议。上传、UDP、批量节点、精确瞬时峰值与截图界面复刻留待后续需求。

## 交付方式

- 单仓工程：[fanbuz/loon-speedtest-plugin](https://github.com/fanbuz/loon-speedtest-plugin)。
- 分发：当前仓库 main/dist 下的 GitHub Raw 文件；安装链接见 README。
- 父任务或跟踪载体：不适用。无外部 Issue 标签、里程碑或受理人约定。

## 实施 checklist

- [x] 共享核心和 Loon API 适配，单路 / 并发 / 顺序对比；见 src/。
- [x] CF / Apple CDN / 自定义下拉；预设源忽略 test_url，Range 源先普通 HEAD 能力声明检查。
- [x] Generic 的成功与错误都返回 HTML，渲染异常回退非空 title/content，保留日志、通知和本地结果。
- [x] 预热和正式测量分别计时并排空，预热计预算但不计速度；页面区分各类耗时与数据。
- [x] 默认构建 GitHub Raw 绝对地址，检查命令不覆盖发行文件。
- [x] 加入原创图标与 MIT 协议，构建后插件和 Generic 入口引用图标。
- [x] 需求、设计、安装、验证和真机清单已更新。
- [x] README 添加原创 SVG 安装按钮，使用官方通用链接导入 GitHub Raw 插件，保留手动入口。

## 依赖 checklist

- [x] Loon 和测速源 API 文档已核对，见 docs/design.md。
- [x] Apple 普通 HEAD 200 与 GET 206 实测兼容有界 Range，CF 公网端点和自定义本地流程验证通过。
- [x] 指定的 GitHub 仓库为公开仓库且 SSH 可访问。
- [ ] 确认用户手机 Loon 完整版本和可用节点。

## 验证 checklist

- [x] 49 项自动化测试及构建/语法检查通过。
- [x] Apple、CF 真实下载与自定义本地 Range 流程通过，见 docs/VERIFICATION.md。
- [ ] 真机点按 README 安装按钮，唤起 Loon 并确认导入；读取插件、脚本和图标，参数与手动运行可用。
- [ ] 真机确认三种测速源及自定义 test_url 条件生效，结果弹窗非空。
- [ ] 真机连接记录证明路由正确，预算、时长、超时、通知和资源检查通过。

## 当前限制

请求并发不等于独立 TCP 连接数；回调统计不等于逐秒真实速率。Apple 和自定义源需要 HEAD 声明字节范围能力与 GET Range 支持；HEAD 200 正常，GET 分块仍要求 206。自定义端点必须正确执行分段语义；正文回调 API 无法主动中断不一致服务器的超大响应。真机证据齐全前保持试用状态。
