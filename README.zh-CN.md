# dsh-release-proof

作者 / 维护者：He Fangsheng (贺方升 / 贺去病; also known as Dosen)· [hequbing.com](https://www.hequbing.com)

[![CI](https://github.com/dongsheng123132/dsh-release-proof/actions/workflows/check.yml/badge.svg)](https://github.com/dongsheng123132/dsh-release-proof/actions/workflows/check.yml)
[![MIT 许可证](https://img.shields.io/github/license/dongsheng123132/dsh-release-proof)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Awesome DSH Plugins](https://img.shields.io/badge/Awesome_DSH-%E5%B7%B2%E9%AA%8C%E8%AF%81%E5%AE%9E%E9%AA%8C-0969da)](https://github.com/dongsheng123132/awesome-dsh-plugins/blob/main/README.zh-CN.md#2origin-%E6%8F%92%E4%BB%B6%E5%AE%9E%E9%AA%8C%E5%AE%A4)

为 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 提供可复现的多源发布证据。

它解决的不是“代码有没有构建成功”，而是“多个下载入口此刻给用户的是否真是同一个版本”。插件读取显式 release manifest，并发下载各镜像，核对 HTTP 状态、响应声明长度、实际字节数、SHA-256 与版本，最后写出内容寻址的 JSON 证据包。

0.2.0 同时是正式 Codex 插件和独立 MCP server，并采用真实 DSH Web Loader 所要求的命名空间导出形态；仓库内有真实 Cordis 启动回归，防止这一加载契约再次漂移。

本工具证明的是“下载传输与多镜像是否和清单声明一致”。它**不**证明发布者身份，也不验证签名发布证明；威胁模型包含这些要求时，应配合签名/来源验证器使用。

## 安全边界

- 只允许匿名 HTTP(S)：拒绝认证字段、自定义请求头、Cookie、URL 查询串和片段。
- 请求有明确超时、重定向上限和响应体上限。
- 工作池把总并发限制在 1–16。
- 每个制品必须声明期望版本、字节数、SHA-256，并至少提供两个下载源。
- 只向显式的、工作区相对路径 `artifactDir` 写入；拒绝目录穿越与符号链接逃逸。
- 证据文件内容寻址、独占写入，并在落盘后回读校验 SHA-256。
- 证据不包含时间戳和耗时；相同网络事实会生成字节完全相同的 JSON。

## 安装到 DSH

```bash
dsh plugin --profile web add github:dongsheng123132/dsh-release-proof
```

DSH bundle 注册两个工具：

- `dsh_release_proof_inspect`：检查清单并返回不含 URL 的摘要。
- `dsh_release_proof_verify`：验证全部下载源并写入证据包。

参数示例：

```json
{
  "manifestPath": "release/release-manifest.json",
  "artifactDir": "release/evidence"
}
```

## MCP

`.mcp.json` 还声明了独立 stdio MCP server：

- `release_manifest_inspect`
- `release_verify`

MCP 只接收最大 1 MiB 的显式内联 `manifestJson`，不读写文件系统。联网仍然是匿名 HTTP(S)，并受清单中的超时、并发、重定向和响应字节上限约束；返回的确定性内容寻址描述可由调用方重新计算验证。

## 命令行

```bash
dsh-release-proof inspect --root D:/project --manifest release/release-manifest.json
dsh-release-proof verify --root D:/project --manifest release/release-manifest.json --artifact-dir release/evidence
```

退出码：`0` 表示所有校验通过；`2` 表示证据已成功写出，但发布一致性校验未通过；`1` 表示清单或运行错误。

## 版本证据

下载源可从制品响应头读取版本：

```json
{ "kind": "header", "name": "x-release-version" }
```

也可从匿名 JSON 版本文件读取：

```json
{ "kind": "json", "url": "https://downloads.example.com/version.json", "field": "release.version" }
```

完整格式见 [`examples/release-manifest.example.json`](examples/release-manifest.example.json)。

## 开发验证

```bash
npm test
npm run check
npm run smoke:plugin
npm run smoke:mcp
python C:/Users/ZhuanZ/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

要求 Node.js 22+。包内没有安装生命周期脚本，运行依赖只有可选的 DSH tools SDK peer。

## 许可证

MIT
