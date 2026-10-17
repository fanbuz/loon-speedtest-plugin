# 速度测试设计

## 请求与数据

- 下载 CF：GET `https://speed.cloudflare.com/__down?bytes=N`，HTTP 200、Uint8Array 实际长度必须等于请求字节数。
- 下载 Apple：`https://mensura.cdn-apple.com/api/v1/gm/large`。Apple 与自定义下载先普通 HEAD，接受 200 + Accept-Ranges: bytes；真正 GET 必须 206 且 Content-Range / 实际长度匹配。失败不回退完整文件。
- 上传 CF：POST `https://speed.cloudflare.com/__up`，发送预先生成、复用的非零 Uint8Array。二进制请求体由 Loon API 发送；成功 HTTP 200/204 后按请求体大小计上传量，绝不把小响应体计作上传量。设置 Content-Type、CF 的 Origin 与浏览器兼容 User-Agent；自定义地址不附加 CF 的 Origin。
- 上传计数代表成功 POST 对应的提交字节数，没有独立的服务端逐字节回执。自定义上传地址须完整读取请求体再返回成功状态；不是任意网页地址。
- 两个预设源忽略自定义字段。自定义下载读取 test_url，上传读取 upload_url；上传留空使用 CF。Apple 仅作为下载源，结果分别标注两项来源。
- 所有请求显式传 node，超时单位为毫秒。禁用重定向，不改全局代理或策略选择。

## 顺序、预算与失败

默认 direction=both。先运行下载的全部模式，再运行上传。compare 顺序为单路下载、并发下载、单路上传、并发上传，各轮均先预热并排空，再重新正式计时。

总请求数据预算默认 64 MB。按方向及模式均分，双向 single 每项 32 MB，双向 compare 每项 16 MB，包含各自预热。预热最多使用本轮预算 1/4，提前用完会提前停发。时长或预算先到就停止新请求，在途结束后再进入下一阶段。总预算不是含协议开销的计费流量上限。

失败请求不退款、不重试；本方向的比较中止。明确结束的下载失败后仍可尝试上传，保留部分成功结果。若有请求未回调（包括 HEAD 与预热），不启动后续阶段，避免未知在途与新测量重叠。Generic 总超时为 300 秒，覆盖最大配置下的四轮测量、预热和收尾。

## 测量口径

正式速度 = 正式成功下载字节（或成功 POST 的请求体字节）/ 正式统一墙钟时间。并发不累加请求时长；等待、服务端响应和收尾都在分母中。预热不进入正式速度，但计总预算、总量与总耗时。MB 为十进制，1 MB/s = 8 Mbps。

Loon 只给完成回调，不能据此输出真实逐秒峰值。HTTP 并发不证明底层有 N 条独立 TCP 连接；预热不保证完全消除新连接影响。短样本提示增加预算复测。

## 原生弹窗

手机截图证明浏览器式 grid/flex、CSS 变量和背景色在宿主中不能按预期呈现。结果改用内联字号、字体、颜色及普通段落/换行，不设置背景、不使用 class 或 style 块，不依赖脚本、网络字体或图片。统一无衬线，数字收敛为 30px；默认只显示下载、上传两项及一行总计。原生 HTML 排版器用于兼容性检查，仍需 Loon 真机回归。

成功/部分成功均 `$done({title, htmlMessage})`，渲染异常回退 title/content；关闭通知不影响结果。日志和 `$persistentStore` 保存完整明细。

## 构建与分发

npm run build 生成 main/dist 的绝对 Raw 脚本地址，附版本参数。安装按钮使用 Loon 官方通用链接，对完整插件 URL 编码。检查在临时目录构建，不覆盖发行包。其他托管必须传 --base-url 重新构建。

## 一手资料

- [Loon HTTP 请求、POST 二进制及 timeout 单位](https://nsloon.app/docs/Script/script_api/)
- [Loon Generic 与脚本超时](https://nsloon.app/docs/Script/script_v2/)
- [Loon Scheme 与通用导入链接](https://nsloon.app/docs/Scheme/)
- [Cloudflare 官方下载/上传端点](https://github.com/cloudflare/speedtest/blob/main/README.md)
- [HTTP Range 语义](https://www.rfc-editor.org/rfc/rfc9110.html#name-range)

核对日期：2026-10-17。
