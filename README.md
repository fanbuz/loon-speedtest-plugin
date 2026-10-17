# Loon Speedtest

<img src="assets/icon.png" width="96" height="96" alt="Loon Speedtest 图标">

在 Loon 中手动测试同一节点的单路或多路并发下载表现。v0.1.1 支持结果弹窗、测速源选择和 GitHub Raw 分发；Loon 真机回归验收待完成。

| 模式 | 行为 |
| --- | --- |
| `single`（默认） | 始终最多 1 个在途下载请求 |
| `concurrent` | 最多 N 个在途请求，默认 4，可选 2 / 8 |
| `compare` | 先单路，再 N 路；总请求数据预算均分，两阶段不重叠 |

测速源下拉可选 **Cloudflare**（默认）、**Apple CDN**、**自定义**。只有选择自定义时，`test_url` 才有效；两个预设源完全忽略它。

## 本地开发

需要 Node.js ≥ 22；没有第三方依赖，无需 `npm install`。

```sh
npm run check
npm run smoke -- --local  # 本地回环验证，不测公网带宽
npm run smoke            # Mac 系统网络访问 Cloudflare；最多请求 4 MB 数据
npm run smoke -- --source apple  # Apple Range 流程；最多请求 4 MB 数据
npm run build            # 生成当前仓库 GitHub Raw 分发包
```

`dist/loon-speedtest.js` 是构建后的独立 Loon 脚本，`dist/LoonSpeedtest.plugin` 是插件配置，`dist/icon.png` 是图标。`npm run check` 在临时目录构建，不会覆盖发行配置。

## 在 Loon 里安装

要求 Loon 3.5.1 (983)+。在 Loon 的插件页面添加这个地址：

[安装 / 更新 LoonSpeedtest.plugin](https://raw.githubusercontent.com/fanbuz/loon-speedtest-plugin/main/dist/LoonSpeedtest.plugin)

1. 插件参数 **node** 填已有节点或策略组的精确名称；直连必须明确填 `DIRECT`。
2. 测速源默认 Cloudflare，也可选 Apple CDN。选“自定义”后，在 `test_url` 填直接下载文件的 HTTP(S) 地址；该源须正确支持 HEAD 和 GET Range。
3. 模式先用 `single`，再选 `concurrent` 或 `compare`；并发默认 4。
4. 从 Loon 的 Generic 手动脚本入口执行「下载测速」，安装后不会自动运行。
5. 完成时结果弹窗显示摘要；脚本日志含过程与错误，通知可关闭。最后结构化结果保存在 `$persistentStore` 的 `loon-speedtest:lastResult`。

更新代码后，在 Loon 更新插件及脚本缓存。日志首行包含 `v0.1.1 | 脚本已加载`，可确认正在运行新脚本。

## 测速源

| 下拉选项 | 地址与请求方式 | test_url |
| --- | --- | --- |
| Cloudflare（默认） | `https://speed.cloudflare.com/__down?bytes=N`，GET 定量下载 | 忽略 |
| Apple CDN | `https://mensura.cdn-apple.com/api/v1/gm/large`，HEAD/GET Range 分块 | 忽略 |
| 自定义 | 使用填写的 HTTP(S) 直链，HEAD/GET Range 分块 | 必填且只在此时生效 |

Apple 和自定义源先发 `HEAD` 携带 `Range: bytes=0-65535`，确认 206 与正确 Content-Range 后，才发正文 GET。每个 GET 再校验 206、Content-Range 和实际二进制字节数。不支持分段的源会给出明确错误；不会自动退回整文件下载。

自定义地址原样保留查询参数，不附加 Cloudflare 的 `bytes` 参数。页面地址、需要登录的下载页和不支持 HEAD Range 的端点不适用。`test_url` 控件始终可见，但预设源不会读取它。

## 其他分发与本地开发

默认 `npm run build` 固定使用当前 GitHub 仓库，生成的脚本与图标 URL 均为 Raw 绝对地址。

上传 OSS 或使用局域网服务前，必须按实际对象目录重新构建。例如三个文件上传到 `https://assets.example.com/loon/dist/`：

```sh
npm run build -- --base-url https://assets.example.com/loon/dist/
```

将 **dist 下的插件、JS、图标三个文件一起上传**，然后在 Loon 使用对应 `.plugin` 直链。仅把原分发文件搬到新域名，不会改变插件里写入的脚本地址。

局域网试用可以用 `--base-url http://实际MacIP:8787/` 构建，再执行 `npm run serve -- --host 0.0.0.0 --port 8787`。服务只提供三个安装文件；`Ctrl-C` 停止。

本地脚本方式须显式执行 `npm run build:local`，把构建后的 JS 放到 Loon 可访问的本地脚本位置，再在主配置 `[Script]` 添加：

```ini
generic then script("loon-speedtest.js", "mode=compare&node=你的节点名称&test_source=cf&concurrency=4&duration=10&maxMB=64") with tag="下载测速", timeout=120
```

包含 `&`、`+`、`=` 的查询字符串参数值须用 `encodeURIComponent` 编码；插件参数输入无需编码。未传 node 时仅使用入口的 `params.node` / `params.policyGroup`；无法识别就报错，不猜 nodeInfo 内部字段。

## 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `single` | `single` / `concurrent` / `compare` |
| `node` | 空 | 节点名、策略组名或 `DIRECT`；无上下文时必须填写 |
| `test_source` | Cloudflare | 下拉：Cloudflare / Apple CDN / 自定义；脚本参数也接受 cf / apple / custom |
| `test_url` | 空 | 仅自定义生效；HTTP(S) 直链且支持 HEAD/GET Range |
| `concurrency` | 4 | 2–8 的整数；单路模式忽略 |
| `duration` | 10 | 每轮发请求窗口，3–30 秒；不是硬性总时长 |
| `chunkKB` | 1000 | 每次请求数据量，64–4000 KB，十进制 |
| `maxMB` | 64 | 所有轮次合计请求数据预算，4–256 MB，十进制 |
| `requestTimeout` | 5 | 每个请求超时，1–15 秒 |
| `notify` | true | 是否发送结果通知 |

到达时长或预算就停止发新请求，等待在途请求结束。两者以先到者为准；正常总时长可能超过 duration。回调缺失时在 `duration + requestTimeout + 1 秒` 兜底，将结果标为不完整并结束本次脚本。

## 如何读结果

- 平均速度 = **成功的真实二进制响应总字节 / 本轮首个请求调度至全部请求回调的墙钟时间**，包含建连、TLS、等待和收尾，是分块下载的应用层吞吐。并发使用统一的墙钟时间，不把各请求耗时相加。
- `1 MB = 1,000,000 B`；`1 MB/s = 8 Mbps`。失败、非 200、非二进制、长度不符时不提供有效速度；不会用 Content-Length 推算已下载量。
- 日志里的累计数据只在下载完成回调时更新，**不是每秒真实流量**。本版不输出瞬时峰值或逐秒中位数。
- 并发指 N 个在途 HTTP 请求。设置 HTTP/1.1，但 Loon 和代理协议可能复用底层连接；没有独立 TCP 连接数的观测证据。
- 64 MB 是请求的数据预算，包含失败请求的预留份额；不等于运营商或机场计费流量上限，不含协议开销、失败请求未知部分。遇到错误不重试。对比时每轮最多请求 32 MB。
- `compare` 按先单路后并发顺序运行，网络状态和缓存可能变化；比例只代表本次采样。小分块、高延迟和短样本会压低吞吐或放大波动。
- 向 Cloudflare 发请求不等于复现 Cloudflare 网页的完整测速算法。本版不依赖其浏览器 SDK，不做上传、UDP、丢包或截图原生界面复刻。

## 项目资料

- [当前需求](docs/requirements.md)
- [设计与资料来源](docs/design.md)
- [当前任务和验收](docs/TASKS.md)
- [验证记录](docs/VERIFICATION.md)
- [真机测试步骤](docs/TESTING.md)

## 故障排查

- **empty content**：v0.1.1 无论成功或失败都用 `$done({title, content})` 返回内容。先更新插件和 JS；若没有“脚本已加载”日志，检查插件中的脚本 URL 能否直接返回 JS 正文。
- **仍引用局域网地址**：重新执行默认 `npm run build` 并更新分发文件；移动文件不会重写引用地址。
- **自定义源 Range 检查失败**：检查下载直链、HEAD 权限及 206 / Content-Range，换用支持分段的源。
- **Raw 无法访问**：先检查设备网络能否读取上方插件地址，地址必须返回文本配置而不是 GitHub HTML 页面。

## 协议与图标

代码和图标采用 [MIT](LICENSE) 协议。图标使用 imagegen 生成，深石墨与缎面钛金属风格；[设计说明及提示词](assets/README.md)。
