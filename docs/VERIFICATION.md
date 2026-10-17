# v0.3.0 验证

日期：2026-10-17。Loon 真机回归待完成。

## 本次结果

- 73 项自动化测试、构建与语法检查通过。新增独立源选择、默认 Apple、旧自定义参数兼容、Apple Bytes 回执校验、Loon 二进制/字符串 JSON 解析和无效回执拒绝。
- 本地服务省略 HEAD Accept-Ranges，仍提供合法 Range GET，完整读取 POST 并返回 Bytes；双向单路/4 路对比及各轮预热全部成功，总请求数据 4 MB。
- 实际 Apple 官方端点的同一流程全部成功：普通 HEAD 200、GET 206、POST 200；每笔上传必须通过服务端接收字节与请求体相等的校验，总请求数据 4 MB。
- 单路/4 路正式下载分别约 0.62/0.27 秒、上传约 2.48/0.79 秒，正式数据每项 0.75 MB。预算刻意较小，只证明协议与流程可用，不能用于线路性能结论。
- Apple 配置列出 `/large` 与 `/slurp`；额外 64 KiB POST 返回 `{"DurationMs":41,"Bytes":65536,"BPS":1598439}`，采用本地计时与 Bytes 校验，不直接使用 BPS。
- 菜单构建固定引用 `arrow.up.arrow.down.system`，已在 macOS 检查系统符号存在；PNG 为 RGBA 真透明，四角及画布边缘透明，品牌图标 URL 带版本参数。
- 对端关闭连接时弹窗显示短中文说明，日志和持久化保留完整系统错误。不能从该错误推断 CF 全面不可用。

以上 Mac 网络、模拟 Loon 与 macOS 系统图标检查均不替代 Loon iOS 的节点路由、菜单渲染及真实测速回归。

## 分发

v0.3.0 的 README、Raw 插件与 JS 使用一致版本；插件列表使用透明品牌图，节点菜单使用系统符号。旧安装保留的下载源须手动改 Apple CDN，新增上传源默认 Apple CDN。

## 依据

[Apple 官方配置](https://mensura.cdn-apple.com/api/v1/gm/config) · [Apple 上传协议](https://github.com/network-quality/server/blob/main/SERVER_SPEC.md) · [Loon Generic 系统图标语法](https://nsloon.app/docs/Script/script_v2/)。
