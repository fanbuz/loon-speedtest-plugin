# 能力：速度测试 v0.2.0

当前状态：实现与开发验证完成，待 Loon 真机回归。

## 目标与范围

提供指定节点的下载和上传测试，支持单路、并发、顺序对比及独立预热。重做原生弹窗结果，精简 README 并将居中图标、徽标和安装按钮放在首屏。公开 GitHub Raw 分发，MIT 协议。

## 交付方式

- 单仓工程：[fanbuz/loon-speedtest-plugin](https://github.com/fanbuz/loon-speedtest-plugin)。
- 分发：main/dist，安装入口在 README 顶部。
- 父任务及外部受理依赖：不适用。

## 实施 checklist

- [x] direction 默认 both，分别下载/上传，可选只测其中一项。
- [x] 复用调度器实现二进制 POST 上传；真实请求体计数，单路/并发/比较与预算约束覆盖双向。
- [x] 双向分别预热和计时，阶段排空；已知失败可保留部分结果，未回调时不追加阶段。
- [x] 名称统一为速度测试；下载源可选 CF/Apple/自定义，上传默认 CF，可配置自定义 POST 源。
- [x] 结果改为无背景的紧凑内联富文本，明细保留日志。
- [x] README 居中图标、徽标、安装按钮首屏可见；移除图标生成和冗余文本。
- [x] 更新构建、测试、安装和设计文档。

## 依赖 checklist

- [x] 核对官方 Loon Uint8Array POST、毫秒超时、Generic 和通用导入链接文档。
- [x] CF 上传 POST 已得到 HTTP 200；下载源与真实流程验证见 VERIFICATION.md。
- [x] GitHub 仓库公开且可推送。
- [ ] Loon 真机的新样式与 POST 上传兼容性由用户回归。

## 验证 checklist

- [x] 59 项自动化测试与构建语法检查通过。
- [x] 原生 NSAttributedString HTML 预览无文字背景块，浅/深底色和紧凑排版可读。
- [x] 本地服务完整接收二进制 POST，双向四轮、各自预热及总预算通过。
- [ ] 真机验证安装/更新、双向速度、单路与并发、参数 UI 和指定节点路由。
- [ ] 真机检查断网、超时、通知及连续运行资源情况。
