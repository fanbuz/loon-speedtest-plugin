<p align="center">
  <img src="assets/icon.png" width="104" height="104" alt="节点速度测试">
</p>
<h1 align="center">节点速度测试</h1>
<p align="center">
  <a href="https://github.com/fanbuz/loon-speedtest-plugin/releases/latest"><img src="https://img.shields.io/github/v/release/fanbuz/loon-speedtest-plugin?color=338276" alt="版本"></a>
  <a href="https://github.com/fanbuz/loon-speedtest-plugin/actions/workflows/check.yml"><img src="https://github.com/fanbuz/loon-speedtest-plugin/actions/workflows/check.yml/badge.svg" alt="构建状态"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-527caa" alt="MIT License"></a>
  <a href="https://nsloon.app/"><img src="https://img.shields.io/badge/Loon-3.2.1%20%28745%29%2B-777777" alt="Loon 3.2.1 (745)+"></a>
</p>
<p align="center">
  <a href="https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Ffanbuz%2Floon-speedtest-plugin%2Fmain%2Fdist%2FLoonSpeedtest.plugin%3Fv%3D0.4.1"><img src="assets/add-to-loon.svg" width="276" height="76" alt="一键添加到 Loon"></a>
  <br>
  <a href="https://raw.githubusercontent.com/fanbuz/loon-speedtest-plugin/main/dist/LoonSpeedtest.plugin?v=0.4.1">Raw 安装地址</a> · <a href="https://github.com/fanbuz/loon-speedtest-plugin/releases/latest">下载发行包</a>
</p>

在 Loon 中测试指定节点的**下载与上传速度**，支持单路、多路并发和顺序对比。

## 使用

1. 在 iPhone / iPad 上点按上方按钮，唤起 Loon 后确认添加；无法唤起时用 Safari 打开，或手动添加 Raw 地址。
2. 插件参数 `node` 填已有节点或策略组的精确名称；直连填 `DIRECT`。
3. 从 Generic 手动脚本入口运行「节点速度测试」。默认先下载、再上传，每项先用小块单路预热，再按所选模式测量。

兼容目标为 Loon **3.2.1（745）及以上**，旧版真机回归待完成。

结果在节点名称下显示协议（如 Hysteria2、Trojan、Shadowsocks）；从节点菜单运行时读取 Loon 提供的信息，无法确认时显示“协议 · 未知”。

更新后刷新插件和脚本缓存，日志首行应包含 `v0.4.1`。旧安装请确认“自适应测量”已开启，HTTP 版本选 auto。

## 选项

| 参数 | 默认值 | 可选内容 |
| --- | --- | --- |
| 测试项目 `direction` | `both` | 下载和上传 / 仅下载 / 仅上传 |
| 模式 `mode` | `single` | 单路 / 并发 / 单路与并发对比 |
| 自适应 `adaptive` | 开启 | 动态分块、错峰并发、有限故障恢复；关闭可作固定分块对照 |
| HTTP 传输 `httpVersion` | `auto` | HTTPS 优先 h2，明确失败时允许一次 h1 恢复；可固定 h1 / h2 |
| 下载源 `test_source` | Apple CDN | Apple CDN / Cloudflare / 自定义 |
| 上传源 `upload_source` | Apple CDN | Apple CDN / Cloudflare / 自定义 |
| 并发数 `concurrency` | 4 | 2 / 4 / 8 |
| 每项测量窗口 `duration` | 10 秒 | 5 / 10 / 15 / 30 秒 |
| 请求超时上限 `requestTimeout` | 10 秒 | 自适应正式阶段按块大小缩短；3 / 5 / 10 / 15 秒 |
| 下载分块上限 `chunkKB` | 4000 KB | 自适应从 64 KB 起步；可选 64 / 250 / 1000 / 4000 KB |
| 上传分块上限 `uploadChunkKB` | 1000 KB | 独立于下载；可选 64 / 250 / 1000 / 4000 KB |
| 预热窗口 `warmup` | 2 秒 | 0 关闭，或 1 / 2 / 3 / 5 秒 |
| 总数据预算 `maxMB` | 64 MB | 包含全部下载、上传及预热；各项均分 |

下载和上传独立选择，默认均使用 Apple CDN。Apple 上传会核对服务端接收字节回执。

下载源选“自定义”时填写 `test_url`，地址须支持 HEAD / Range GET。上传源选“自定义”时填写 `upload_url`，地址须完整接收二进制 POST 后返回成功；预设源忽略对应自定义地址。

结果为应用层平均速度。预热及失败尝试占预算；恢复后仅用独立成功阶段计算速度，实际并发和恢复提示会显示在结果中。MB 使用十进制，`1 MB/s = 8 Mbps`；达到时长或预算后停止新请求，等待在途完成。未回调请求会停止后续测试；403、429 与数据校验失败不会重试。详细参数、逐请求耗时与错误见日志。

## 开发

Node.js ≥ 22，无第三方依赖。

```sh
npm run check
npm run smoke -- --local
npm run build
```

分发文件在 `dist/`。其他托管地址使用 `npm run build -- --base-url https://host/目录/` 重新构建。

[参数与实现](docs/design.md) · [测速参考](docs/speedtest-references.md) · [真机测试](docs/TESTING.md) · [验证记录](docs/VERIFICATION.md) · [MIT](LICENSE)
