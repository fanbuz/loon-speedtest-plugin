# v0.1.1 验证记录

日期：2026-10-17。代码、构建和接口验证已完成；Loon 真机回归待完成。

## 自动化

`npm run check`：37 项通过，临时构建与生成 JS 语法检查通过。覆盖：

- 参数约束、显式目标、数据预算、单路/并发调度、排空在途、顺序对比、墙钟统计。
- 异常、限流、响应字节不符、回调缺失/延迟、短样本提示。
- Generic 成功、失败、通知关闭、存储或通知异常时，都返回非空 title/content；只调用一次 $done。
- 默认 GitHub Raw 地址、其他托管对象目录、本地引用必须显式选择、非法地址不覆盖已有安装包。
- 默认 CF；预设源忽略 test_url；自定义才校验并使用 test_url，保留原查询参数。
- Apple/自定义 HEAD Range 检查、GET Range 范围校验、不支持分段时不发正文 GET。
- 模拟 Loon API 透传 HEAD、GET、node、Range、二进制内容和结果输出。

`npm run check` 在临时目录构建，不会改写已生成的 GitHub/其他托管安装包。

## 真实接口与本地流程

| 检查 | 结果 |
| --- | --- |
| Apple 独立 HEAD / GET 64 KB Range | 均返回 206，Content-Range 为 bytes 0-65535/4294967296，GET 实读 65536 B |
| `npm run smoke -- --source apple` | HEAD 预检通过，单路与 4 路分别下载 2 MB，共 4 MB；正常结束 |
| `npm run smoke` | CF 单路确认 0.50 MB、4 路确认 2 MB；正常结束，单路因窗口结束、并发因预算结束 |
| `npm run smoke -- --local --source custom --test-url http://localhost/test.bin` | 本地模拟自定义 HEAD/GET Range，两模式共 4 MB；正常结束 |

这些测试使用 Node HTTP 客户端访问 Mac 系统网络或本地回环。工具中的 DIRECT 是标签，不是已验证的 Loon 路由；不能把结果当作手机节点带宽，也不能根据一次短样本判断长期带宽。

## 发布和真机验收

分发地址见 README。发布后需直接读取 Raw 的插件、JS、图标并与本地构建产物校验；真机继续按 [测试清单](TESTING.md) 核对安装、路由、源选择、结果弹窗、超时、通知和设备资源。
