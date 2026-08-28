# 按 API 密钥分配模型（fork 增强）

上游 CPA 把所有入站 `api-keys` 视为等权：任何合法 key 都能列出并调用全部已注册模型。
这个 fork 增加了可选的按 key 模型白名单。

## 配置

```yaml
api-keys:
  # 纯字符串 = 不限制，可用全部模型
  - jokerchan0801

  # 对象形式 = 只能用列出的模型
  - key: zhangjinsheng
    models:
      - deepseek-v4-pro
      - 牛来

  - key: liangjingrong
    models: [deepseek-v4-flash]

  # 显式通配，等同于不限制
  - key: admin-key
    models: ["*"]
```

两种形式可以混写。**不写 `models` 字段的 key 不受限制**，所以升级到这个 fork 后，
原有配置文件不改也能跑，行为与上游完全一致。

模型名写**原始名称**（`/v1/models` 里 OpenAI 方言返回的那个），不用管各方言的改写形式。

## 管理界面

先登录 `/management.html`，登录成功后右下角才会出现“模型分配”按钮。登录页不会显示入口，
退出管理后台后入口也会立即隐藏。模型分配页为 `/model-acl.html`。

页面通过已有的 management secret 调用以下接口：

- `GET /v0/management/model-acl`：读取 API Key、分配关系和当前可用模型。
- `PUT /v0/management/model-acl`：保存完整分配并触发配置热更新。

可在页面中切换“全部模型”或“仅指定模型”，并支持搜索、批量勾选和手动填写模型 ID。
保存后立即生效，不需要重启服务。

## 行为

| 场景 | 结果 |
| --- | --- |
| 受限 key 请求模型清单 | 只返回白名单内的模型 |
| 受限 key 调用白名单内模型 | 正常放行 |
| 受限 key 调用白名单外模型 | **404** `The model ... does not exist or you do not have access to it.` |
| 未配置 `models` 的 key | 不受限制 |
| 配置里没有任何受限 key | 中间件短路，零开销 |
| 管理后台登录页 | 不显示“模型分配”入口 |

用 404 而非 403 是有意的：403 会确认"模型存在但你没权限"，让调用方可以枚举出完整模型列表；
404 则让受限 key 无法区分"没这个模型"和"不给你用"。

被拒的请求**不会转发给上游**，不消耗额度。

覆盖的入口：`/v1/*`（OpenAI）、带 `Anthropic-Version` 的 `/v1/*`（Claude 方言）、
`/v1beta/*`（Gemini）、`/openai/v1/*`、`/backend-api/codex/*`。
管理面板 `/management.html`、管理 API `/v0/*`、OAuth 回调不受影响——它们用的是
management secret，不是入站 key。

## 实现

设计目标是**便于 rebase 到上游新版本**，所以改动刻意集中。

### 新增文件（上游永远不会碰，不产生冲突）

| 文件 | 作用 |
| --- | --- |
| `internal/config/model_acl.go` | 解析 api-keys 的两种形态、白名单判定 |
| `internal/config/model_acl_test.go` | 单元测试 |
| `internal/api/model_acl_middleware.go` | 请求拦截 + 模型清单裁剪 |
| `internal/api/handlers/management/config_model_acl.go` | 模型分配管理 API 与 Key 协调逻辑 |
| `internal/api/handlers/management/config_model_acl_test.go` | 管理 API 测试 |
| `internal/api/model_acl_page.go` | 模型分配页面与登录后入口 |
| `internal/api/model_acl_page_test.go` | 页面注入测试 |
| `.github/workflows/fork-model-acl-ci.yml` | fork 自己的 CI |

### 修改的上游文件

| 文件 | 改动 |
| --- | --- |
| `internal/config/sdk_config.go` | `APIKeys` 下方加 `ModelACL` 字段 |
| `internal/config/config_load.go` | unmarshal 前调 `ExtractModelACL`，之后回填 |
| `internal/config/parse.go` | 同上（第二个配置加载入口） |
| `internal/config/config_yaml.go` | 保存配置时恢复受限 Key 的对象形式，避免其他管理操作抹掉分配 |
| `internal/api/server_routes.go` | 挂载动态 ACL、清单过滤和模型分配页面路由 |
| `internal/api/server_management.go` | 注册管理 API，并向管理页注入登录后入口 |
| `internal/api/handlers/management/config_basic.go` | 校验原始 YAML 时保留扩展 Key 形态 |
| `internal/api/handlers/management/config_lists.go` | 增删或重命名 Key 时协调已有分配 |

### 三个关键设计决定

**1. 不改 `APIKeys []string` 的类型。**
它有 9 处引用，其中 `internal/api/handlers/management/config_lists.go` 里有
`h.cfg.APIKeys = append([]string(nil), v...)` 和把 `&h.cfg.APIKeys` 传给
`patchStringList` —— 这些要求类型精确是 `[]string`。改类型会牵动所有这些地方，
每处都变成未来的冲突点。

改为在 `yaml.Unmarshal` **之前**预处理：`ExtractModelACL` 用 `yaml.Node` 把对象形式的
条目拆成白名单 + 纯字符串列表，并改写节点。主解析看到的仍是纯字符串数组，
上游那 9 处代码零改动。

**2. 用中间件覆盖，不改 executor / handler。**
`AuthMiddleware` 在 4 个路由组注册，紧跟其后插一个动态中间件就覆盖了所有模型调用路径，
每次请求读取热更新后的最新配置。
executor、translator、registry 是上游高频改动区，碰它们等于自找冲突。

**3. 清单裁剪用响应拦截，不改各个 handler。**
`/v1/models` 一个端点就分发到 5 个分支（Grok、Home-Codex、Home、Claude、OpenAI），
加上 Gemini 端点共 6 个出口。缓冲响应后统一裁剪，一处代码全覆盖。
清单是小 JSON，缓冲开销可忽略。

## 两个必须处理的细节

**Claude 方言会改写模型名。**
`internal/client/claude/models/models.go` 把非 `claude-*` 的模型 id 重写为
`claude-fable-5-dd-` 加上原名的**字符反转**：

```
deepseek-v4-flash → claude-fable-5-dd-hsalf-4v-keespeed
牛来              → claude-fable-5-dd-来牛
```

白名单存原名，所以判定时要做双向换算（`DecodeClaudeDialectModel`）。
漏掉这步的话，Claude 系客户端（Claude Code 等）会被全部误拦。

**裁剪清单必须重算分页游标。**
Claude 方言的响应带 `first_id`/`last_id`/`has_more`，是从**未裁剪**的列表算出来的。
只过滤 `data` 数组会让游标指向已被移除的条目，客户端判定响应异常，
表现为「取不到模型」。Gemini 的 `nextPageToken` 同理，裁剪后必须删掉。

## 维护流程

改动都在 `model-acl` 分支，用 rebase 保持线性历史。

```bash
# 跟上游更新
git fetch upstream main
git rebase upstream/main

# 推到自己的 fork（CI 会自动跑编译 + 测试）
git push --force-with-lease origin model-acl
```

**为什么冲突会较少**：核心逻辑在新增文件里，上游不会碰；原生文件只保留必要接入点。
若上游重写路由注册、管理配置保存或 SDK 配置结构，自动同步会停止推送并创建 issue，
不会静默发布缺少模型分配功能的版本。

冲突时的检查清单：
1. `ModelACL` 字段还在 `sdk_config.go` 里吗
2. 两个配置加载入口（`config_load.go`、`parse.go`）都调了 `ExtractModelACL` 吗
3. 4 个路由组的 `DynamicModelACLMiddleware` 都还在吗
4. 2 个 models 路由的 `DynamicModelListACLMiddleware` 都还在吗
5. `GET/PUT /v0/management/model-acl` 和 `/model-acl.html` 都还在吗
6. `SaveConfigPreserveComments` 仍会调用 `restoreModelACLAPIKeys` 吗
7. “模型分配”入口是否默认隐藏，并只在 `.sidebar` 挂载后显示
8. 上游有没有新增模型调用端点或新的模型清单出口（对照 `server_routes.go` 的路由注册）

## 未覆盖的范围

只管「能用哪些模型」，不管「能用多少」。受限 key 对白名单内的模型可以无限调用，
没有配额或限流。
