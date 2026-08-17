# dsh-discord

![dsh-discord — Discord 原生的 DeepSeek Harness 远程控制器](assets/dsh-discord-cover.png)

DeepSeek Harness 的双向 Discord 桥接与远程控制插件。

插件以独立 `discord` profile 运行，支持单 Owner、单 Project，以及 Discord DM、服务器文字频道和 Thread。每个 Discord 会话独立映射一个可恢复的 DSH Session；普通文本使用 `followup`，运行中自动排队，只有 `/dsh steer` 进入当前任务最近的步骤。

消息触发规则：Owner 在 DM 中可直接对话；Guild 普通文字频道中的自然语言必须明确 `@Bot`；陌生 Thread 的第一条任务也必须 `@Bot`，一旦 Thread 已绑定 DSH Session，后续对话无需重复 mention。`/dsh` Slash Command 始终不要求 mention。未触发的消息会静默忽略。

## 功能

- DM、Guild 文字频道和 Thread 普通消息
- 每个频道/Thread 独立创建、恢复和持久化 Session
- `/dsh help`、`/dsh status`、`/dsh new`、`/dsh stop`、`/dsh steer`
- 合并限频的进度消息、工具安全摘要和最终结果
- 长结果作为 Markdown 文件发送，禁止 Agent 输出触发 Discord 提及
- 一次性工具审批按钮和结构化问题（选择器、Modal）
- 图片附件通过 `ctx.attachments` 持久化；UTF-8 文本与代码附件直接进入用户消息
- Discord 事件持久去重、Gateway 自动重连、v1 状态自动迁移
- 前台运行及受管后台运行（PID 与独立日志）
- Token 只通过 DSH Credentials 保存和解析

插件不修改 DSH 核心，也不会安装进 `web` profile。

## 要求

- Node.js `^22.19.0` 或 `>=24`
- DeepSeek Harness `dsh` CLI
- Discord Bot 应用及 Token
- Discord Developer Portal → Bot → Privileged Gateway Intents 中开启 **Message Content Intent**

Bot 安装到服务器后，应在需要使用的频道拥有 View Channel、Send Messages、**Send Messages in Threads**、Read Message History、Embed Links 和 Attach Files。`setup` 生成的邀请链接会请求这组权限，`doctor` 也会检查同一组权限。插件不维护额外的 Guild/Channel 白名单；Discord 自身的服务器、频道和角色权限决定 Bot 能看到哪里。为了避免其他成员控制本机，入站操作仍只接受配置的 Owner ID。

## 安装与运行

```bash
# npm 正式发布前，先从 GitHub 安装 CLI。
npm install --global github:suuuuuu-1/dsh-discord
dsh-discord setup --package-spec github:suuuuuu-1/dsh-discord
dsh-discord doctor
dsh-discord start
```

后台运行：

```bash
dsh-discord start --daemon
dsh-discord status
dsh-discord stop
```

全局安装的 CLI 只负责启动和管理插件。插件本体仅在专用 `discord` profile 中启用，并固定到 setup 时选择的单个项目目录；它不会自动出现在每个工作目录，也不会安装进 `web` profile。

`setup` 会验证 Token、生成邀请链接、选择项目目录、将包安装到专用 profile，并通过 `ctx.credentials` 保存 Token。不要把 Token 放进聊天、普通配置、日志或命令行参数。

配置文件默认位于：

```text
~/.dsh/profiles/discord/cordis.patch.yml
```

凭据位于 DSH 管理的：

```text
~/.dsh/.credentials.yaml
```

配置只引用 `DSH_DISCORD_BOT_TOKEN`，不保存明文值。

## 附件

当前 DSH 官方附件 seam 支持 PNG、JPEG、WebP 和 GIF。`dsh-discord` 还支持最大 512 KiB/个、合计 1 MiB 的 UTF-8 文本与常见代码文件。PDF、压缩包、音视频及其他二进制附件会明确拒绝，不会写入项目目录。

## 开发验证

没有真实 Token 时使用 `FakeDiscordTransport`：

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run smoke
```

详细架构见 [DESIGN.md](DESIGN.md)，安全边界见 [SECURITY.md](SECURITY.md)。
