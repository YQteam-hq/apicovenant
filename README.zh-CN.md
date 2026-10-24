<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-lockup-mono.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-lockup.svg">
    <img src="assets/logo-lockup.svg" alt="apicovenant" width="560">
  </picture>
</p>

<p align="center"><strong>OpenAPI 契约守卫。</strong></p>
<p align="center">检查规范文档的设计约定、基于规范起一个 mock、录制真实流量、再对比下一个版本有没有改动契约 —— <strong>零运行时依赖</strong>。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/apicovenant"><img src="https://img.shields.io/npm/v/apicovenant.svg" alt="npm"></a>
  <a href="https://github.com/YQteam-hq/apicovenant/actions/workflows/ci.yml"><img src="https://github.com/YQteam-hq/apicovenant/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.18-5FA04E.svg" alt="node">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-success.svg" alt="dependencies">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

## 问题在哪

大多数团队都有一份 OpenAPI 文档，但真正让它保持诚实的团队不多。

文档和实现之间会朝三个方向同时漂移：

| 漂移类型 | 代价 |
| --- | --- |
| **设计漂移** —— 文档本身合法，但风格不一致：四种错误结构、两种分页方式、路径大小写各写各的 | 每个接入方都要写一套针对单个接口的适配 |
| **规范漂移** —— 实现已经改了，文档没跟上 | 客户端照着没人实现的契约生成代码 |
| **行为漂移** —— 重构之后接口返回的东西悄悄变了 | 线上事故，而测试一条都没拦住 |

现有工具各自覆盖其中一块：schema linter 只检查文档**是否合法**，mock server **依据**文档应答，规范 diff 比较文档的**两个版本**。没有一个能把 **规范 → mock → 录制的真实流量 → 回归对比** 这条链路闭环。

`apicovenant` 一条命令把四件事做完。

## 它能做什么

| 命令 | 作用 |
| --- | --- |
| `apicovenant lint` | 检查 **42 条设计约定规则**，这些规则是纯 schema 校验器根本不会看的 |
| `apicovenant mock` | 基于规范起一个 mock 服务，响应体真实且可复现 |
| `apicovenant record` | 在你的 API 前面放一个录制代理，把真实流量存成 **golden 文件** |
| `apicovenant diff` | 重放 golden 文件，逐字段报告**行为漂移** |
| `apicovenant rules` | 浏览完整规则目录 |
| `apicovenant init` | 生成一份初始配置文件 |
| `apicovenant mcp` | 通过 Model Context Protocol 把契约工具交给 AI agent |

## 为什么零依赖

`apicovenant` 只依赖一个裸的 Node.js 环境。不需要 `npm install`，没有构建步骤，没有 `node_modules`，放进 CI 之前没有任何东西需要审查。

代价是我们自己实现了一部分东西：YAML 子集解析器、JSON Schema 校验器、JSON Pointer 差分。收益是：

- **没有供应链风险。** 整个工具就是这个仓库里的代码。
- **没有安装步骤。** `node bin/apicovenant.mjs` 就是全部准备工作。
- **启动极快。** 不用编译，没有缓存。
- **源码可读。** 所有行为都在 `src/` 里，而不是散落在依赖树中。

源码是 TypeScript，由 Node 原生的类型剥离直接执行，所以依然不需要构建步骤。

唯一的例外是发布到 npm 的包。Node 不允许对 `node_modules` 下的文件剥离类型，
因此压缩包里同时包含编译产物 `dist/`，安装后的命令运行的是它。从仓库直接运行
时仍然执行源码。

## 安装

```bash
# 免安装直接运行
npx apicovenant lint openapi.yaml

# 或者全局安装
npm install -g apicovenant
apicovenant lint openapi.yaml
```

需要 **Node.js ≥ 22.18**（原生 TypeScript 执行能力）。源码是兼容 JavaScript 的 TypeScript；想跑静态检查可以执行 `npm run typecheck`（调用 `tsc --noEmit`）。

## 快速开始

```bash
# 1. 检查契约
apicovenant lint openapi.yaml

# 2. 起一个 mock 用来开发
apicovenant mock openapi.yaml --port 4010

# 3. 录下真实 API 的实际行为
apicovenant record --target http://localhost:3000 --out traffic.golden.json

# 4. 发版前重放一遍，看看哪里变了
apicovenant diff --golden traffic.golden.json --target http://localhost:3000
```

## Lint：设计约定检查

```console
$ apicovenant lint examples/legacy.openapi.yaml
4 errors · 15 warnings · 17 info

GET /create_stock_item

  error   operation-id-required
          GET /create_stock_item has no operationId
          paths./create_stock_item.get
          → Add a camelCase operationId such as "listUsers" or "createUser".

GET /stock_items

  error   response-status-valid
          "20O" is not a valid HTTP status code in GET /stock_items
          paths./stock_items.get.responses.20O
          → Use a three digit status code or "default".
```

每条问题都带一个指向文档内部的 **JSON Pointer**，可以直接定位；而且差分引擎用的是同一套寻址方式。

### 规则清单

8 个分类共 42 条规则，完整说明见 [`docs/rules.md`](docs/rules.md)。

| 分类 | 规则数 | 保护什么 |
| --- | --- | --- |
| `document` | 5 | 版本、联系方式、许可证、HTTPS 服务地址、标签声明 |
| `operations` | 8 | `operationId` 身份、摘要、标签、HTTP 语义 |
| `paths` | 5 | kebab-case、不出现动词、不带结尾斜杠、路径参数 |
| `parameters` | 4 | 路径参数必填、重复定义、文档说明 |
| `responses` | 8 | 成功响应、合法状态码、统一的错误结构 |
| `schemas` | 7 | 命名一致性、未使用的组件、数组元素类型 |
| `security` | 3 | 方案已声明、scope 已声明、凭据不放 query |
| `pagination` | 2 | 统一分页模型、统一集合外层结构 |

几个 schema 校验器**永远不会告诉你的**检查：

- `response-error-envelope` —— 所有失败响应必须用同一个错误结构
- `operation-id-naming` —— `operationId` 要是 camelCase 且以动词开头
- `pagination-consistency` —— 一个接口用 `limit/offset`，另一个用 `cursor`
- `schema-property-naming-consistency` —— 整个 API 不要混用 `camelCase` 和 `snake_case`
- `path-no-verbs` —— `/createUser` 把同一件事说了两遍
- `security-in-query` —— query string 里的 API key 会漏进访问日志

### 报告格式

```bash
apicovenant lint openapi.yaml --format json --output report.json
apicovenant lint openapi.yaml --format html --output report.html
```

HTML 报告是**单个自包含文件** —— 没有 CDN、没有外部字体、没有第三方脚本，可以直接作为 CI 产物上传，或者提交进仓库。

### 挑选规则

```bash
# 只跑你关心的规则
apicovenant lint openapi.yaml --rules operation-id-required,response-error-envelope

# 关掉太吵的规则
apicovenant lint openapi.yaml --ignore schema-example-recommended,info-license-required

# 只看错误
apicovenant lint openapi.yaml --severity error
```

## 配置文件

项目里每次都要用的设置，可以写进文件，而不是每次都敲一遍参数。

```bash
apicovenant init          # 生成 apicovenant.config.json
```

```json
{
  "rules": { "ignore": ["schema-example-recommended"], "only": [] },
  "severity": "error",
  "failOn": "error",
  "format": "text"
}
```

支持 JSON、YAML，以及 `package.json` 里的 `apicovenant` 字段。

**不认识的配置项会直接报错**，而不是被忽略——否则 `severty` 这种拼写错误会让检查
因为错误的原因悄悄通过。命令行参数始终覆盖配置文件。

完整说明见 [docs/configuration.md](docs/configuration.md)。

## Baseline（基线）

一个在存量代码上直接报 400 条问题的 linter，第二天就会被关掉。基线解决这个
问题：把**已经存在**的问题记录下来，之后只有**新增**问题才会让构建失败。

```bash
# 1. 记录当前状态
apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json

# 2. 之后只有新增问题才失败
apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
```

```
✓ no findings
  Shop API v1.4.0 follows every convention.

  document: openapi.yaml
  37 known findings suppressed by the baseline
```

把基线提交进仓库，随着问题被修复让它慢慢变空。详见
[docs/baseline.md](docs/baseline.md)。

## Mock：从规范生成服务

```console
$ apicovenant mock examples/shop.openapi.yaml --port 4010
▶ Shop API v1.4.0 mocking examples/shop.openapi.yaml

  listening on  http://127.0.0.1:4010
  routes        11 operations
  route table   http://127.0.0.1:4010/_apicovenant/routes

  GET     /users
  GET     /users/{userId}
  POST    /users
  ...
```

有 example 就用 example，没有就从 schema **确定性地生成** —— 所以同一份规范跑两次 mock，返回的字节完全一致。

生成的响应体**满足它所依据的 schema**，包括难处理的部分：required 属性一个不少，枚举字段取文档里的值，
比生成器下钻深度更深的 schema 会被截断成**仍然能通过校验**的值，而不是空对象或空字符串。

```bash
# 强制指定状态码
curl 'http://127.0.0.1:4010/users?x-mock-status=404'

# 查看路由表
curl http://127.0.0.1:4010/_apicovenant/routes
```

## 录制与对比

这一部分回答的是「**我这次改动有没有把 API 改坏？**」

```console
$ apicovenant record --target http://localhost:3000 --out traffic.golden.json
▶ recording http://localhost:3000

  proxy   http://127.0.0.1:4011
  output  traffic.golden.json

  point your client at the proxy, then press Ctrl+C to stop
```

golden 文件刻意做成很朴素的 JSON，方便在 PR 里 review：

```json
{
  "apicovenant": 1,
  "recordedAt": "2026-10-23T18:04:11.204Z",
  "target": "http://localhost:3000",
  "spec": "examples/shop.openapi.yaml",
  "interactions": [
    {
      "method": "GET",
      "path": "/users",
      "query": { "page": "1" },
      "status": 200,
      "bodyType": "json",
      "body": "{\"items\":[...],\"total\":1}"
    }
  ]
}
```

**凭据在落盘之前就被脱敏。**

然后重放：

```console
$ apicovenant diff --golden traffic.golden.json --target http://localhost:3000
contract diff
  golden  traffic.golden.json
  source  http://localhost:3000

1 changed · 4 unchanged

✖ GET /users
  • status changed 200 → 500
  • body changed in 2 places (first: changed /items/0/total)
      total changed 42 → 0
      items changed 1 → 0

✓ GET /users/usr_1001

✖ the contract drifted — 1 changed, 4 unchanged
```

默认很保守：**只重放安全方法**，所以跑一次 diff 不会在目标系统里造数据。确实需要重放 `POST`、`PUT`、`PATCH`、`DELETE` 时再加 `--replay-all`。

也可以直接跟 mock 对比：

```bash
apicovenant diff --golden traffic.golden.json --spec examples/shop.openapi.yaml
```

带上 spec 时，新的响应还会**按文档 schema 做校验**，所以「还能解析但已经不符合契约」的响应会被报成 schema 违规。

对着**真实 API** 比对时，schema 违规就是契约漂移，会让这次比对失败；对着**同一份规范生成的 mock** 比对时，
这个校验是自我循环的 —— mock 就是这份规范自己的渲染，只能印证自己。这类问题会被单独列为生成器的局限，
**不会**算成漂移。

## 接入 CI

```yaml
- name: 检查 API 契约
  run: |
    npx apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
    npx apicovenant diff --golden traffic.golden.json --target "$API_URL"
```

如果存量代码还不干净，先记录一次现有问题并把基线提交进仓库——之后构建就只会
因为**新增**问题而失败。

### 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 存在超过阈值的问题，或者契约发生漂移 |
| `2` | 用法错误（未知参数、未知规则、缺少必填项） |
| `3` | 文档读取或解析失败 |

## 交给 AI agent

写 OpenAPI 文档的 agent 需要的答案和你一样：有没有违反约定、这个接口长什么样、
上次改动有没有把契约改坏。`apicovenant mcp` 通过
[Model Context Protocol](https://modelcontextprotocol.io) 把这些答案送过去。

```bash
apicovenant mcp
```

在客户端里配上：

```json
{
  "mcpServers": {
    "apicovenant": {
      "command": "apicovenant",
      "args": ["mcp"]
    }
  }
}
```

agent 会拿到五个工具 —— `lint_openapi`、`list_rules`、`list_operations`、
`example_response`、`check_contract_drift` —— 以及作为 resource 的规则手册。
协议是直接照规范实现的，**不引入任何 MCP SDK 依赖**，零运行时依赖的承诺依然成立。

各编辑器的客户端配置和完整工具说明见 [docs/mcp.md](docs/mcp.md)。

## 作为库使用

CLI 能做的，程序里都能做：

```ts
import { lint, loadSpecFile, startMockServer, compareGolden } from 'apicovenant';

const spec = await loadSpecFile('openapi.yaml');
const { findings } = lint(spec);

const mock = await startMockServer(spec);
console.log(mock.url);
```

入口导出了规则引擎、规范加载器与模型、JSON Schema 校验器、mock 服务、录制器、
差分引擎，以及三种报告渲染器。

## 项目结构

```
src/
  yaml/        YAML 1.2 子集解析器（零依赖）
  spec/        加载器、$ref 解析、规范化操作模型
  lint/        规则引擎 + 规则目录
  mock/        基于规范驱动的 mock 服务
  record/      录制代理 + golden 文件格式
  diff/        带 JSON Pointer 路径的契约差分
  report/      终端、JSON、独立 HTML 报告
  mcp/         Model Context Protocol 服务端
  cli/         参数解析与命令分发
```

linter、mock server 和 recorder 都基于**同一份**规范化模型工作，因此它们对「一个 operation 是什么」的理解永远一致。

## 参与贡献

欢迎贡献 —— 流程、代码风格以及如何新增一条规则，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```bash
git clone https://github.com/YQteam-hq/apicovenant.git
cd apicovenant
node --test
```

## 支持与联系

`apicovenant` 由 **YQteam** 维护。

| | |
| --- | --- |
| 维护方 | [YQteam](https://yq-tuandui.xyz) |
| 仓库 | [github.com/YQteam-hq/apicovenant](https://github.com/YQteam-hq/apicovenant) |
| 问题反馈 | [github.com/YQteam-hq/apicovenant/issues](https://github.com/YQteam-hq/apicovenant/issues) |
| 安全问题 | 见 [SECURITY.md](SECURITY.md) |
| 邮箱 | [yqteam@yeah.net](mailto:yqteam@yeah.net) |

### 品牌

图标是石墨色的方螺旋。文字标使用 [Outfit](https://fonts.google.com/specimen/Outfit)
并已转为轮廓路径，所以在任何环境渲染一致，运行时也不依赖字体。

| 文件 | 内容 |
| --- | --- |
| `assets/logo.svg` | 单独的图标 |
| `assets/logo-mono.svg` | 浅色图标，用于深色背景 |
| `assets/wordmark.svg` | 单独的文字标 |
| `assets/wordmark-mono.svg` | 浅色文字标，用于深色背景 |
| `assets/logo-lockup.svg` | 图标 + 文字 |
| `assets/logo-lockup-mono.svg` | 浅色组合标，用于深色背景 |
| `assets/icon.svg` | 圆角方块内的图标 |

Outfit 依据 SIL Open Font License 1.1 授权，声明随资产一起分发，见
[assets/FONT-LICENSE.txt](assets/FONT-LICENSE.txt)。

## 许可证

[Apache-2.0](LICENSE) © 2026 YQteam (yq-tuandui.xyz)

本项目基于 Apache License 2.0 发布。你可以自由使用、修改和再分发本软件
（包括闭源与商业用途），唯一义务是保留版权声明与许可证全文；该许可证还附带
来自所有贡献者的明确专利授权。
