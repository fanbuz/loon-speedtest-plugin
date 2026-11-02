# v0.5.1 验证

日期：2026-11-03。最低兼容目标仍为 Loon 3.2.1（745）。本版修复 0.5.0 的启动异常；Loon 真机修复效果仍未验证，不以模拟通过代替实际运行；按用户于 2026-11-03 的决定，不将该证据作为本次关单前置条件。

## 故障与修复

用户在 Loon 启动时收到 `TypeError: undefined is not an object (evaluating 'metadata.version')`。构建器声明 `var LoonSpeedtestMetadata`，核心却从 `globalThis` 对象读取它；宿主在函数中运行脚本时，该声明属于局部作用域，不能假设全局属性存在。也不能误用全局残留的旧版本。

以原始 v0.5.0 发行脚本作为输入，在 Node VM 的函数包装中复现未定义 version；在 macOS JavaScriptCore 中得到与截图相同的完整错误文字。此前自动化只在全局顶层执行 bundle，15 次集成流程也漏掉了宿主局部作用域，这是 0.5.0 验收的缺口。

修复后，核心直接读取构建注入的词法绑定。Node 仍从同一 package.json 元数据模块读取；版本与日期的唯一来源、构建方式、路由和测速调度均保持原有约定。README、插件和脚本缓存键更新为 0.5.1。

## 本次验证

`npm run build` 生成默认 GitHub Raw 产物，`npm run check` 通过 136 项测试、远端/本地临时构建语法、dist 三文件逐字节一致性和 README 版本检查。检查没有改写 dist。

新增回归在真实生成的 bundle 上执行：普通函数/严格函数 × 全局元数据缺失/全局存在旧值四种组合。检查结果与日志采用当前版本，日期正确，不改写全局旧值；下载和上传实际启动、路由正确，结构化结果成功且 `$done` 仅返回一次非空 HTML。新增测试在修复前失败，修复后通过。原有顶层运行、Node 直接加载、重复构建与非法元数据回归继续通过。

另使用 macOS JavaScriptCore 执行当前 `dist/loon-speedtest.js`，以严格函数包装分别模拟全局元数据缺省和残留旧版本。两次均通过：Apple HEAD/Range GET/POST 回执模拟、双向 compare 四轮、AnyTLS 识别、显式节点路由、4 MB 总预算、正确版本日志与一次 HTML 返回；排空计时回调后没有追加结果。

JavaScriptCore 验证的是 JavaScript 作用域与模拟流程，不是 Loon API 真机或代理节点测试。

## 既有证据与边界

[0.5.0 开发验证记录](https://github.com/fanbuz/loon-speedtest-plugin/blob/v0.5.0/docs/VERIFICATION.md) 包含 340 组重构前后对照、本地 HTTP 双向冒烟和 7 类 macOS 富文本预览。这些只说明当时对应测试模型通过，不能证明当时的 Loon 启动兼容性。本次没有改动测速调度或展示布局，也未重复远端测速。

[TESTING.md](TESTING.md) 中的 3.2.1（745）/当前版安装、AnyTLS 实际入口、H1/H2 真机对照和原生显示仍待验证；#3、#5、#9 已按用户确认的验收范围关闭，0.5.0 里程碑完成。未验证项目保留为可选复核参考，不记为通过。更新插件后，日志首行应为 `节点速度测试 v0.5.1`，原 metadata.version 异常不应再出现。
