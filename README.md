# dsh-discord

![dsh-discord — Discord-native DeepSeek Harness remote controller](assets/dsh-discord-cover.png)

Bidirectional Discord bridge and remote controller for DeepSeek Harness.

The dedicated `discord` profile supports one owner and project across DMs, guild text channels, and threads. Each Discord conversation owns an independently persisted DSH Session. Owner DMs trigger directly; ordinary guild-channel messages require an explicit bot mention; an already-bound thread continues without repeated mentions. Slash commands never require a mention.

The bot invite requests View Channel, Send Messages, **Send Messages in Threads**, Read Message History, Embed Links, and Attach Files. `doctor` checks the same permission set. Discord server and channel permissions determine where the bot is visible; the plugin remains single-owner and fail-closed.

The controller includes natural text, `/dsh status/new/stop/steer`, coalesced progress, approvals, structured questions, image and text/code attachment ingress, durable event deduplication, Gateway reconnect, and managed daemon operation.

Enable **Message Content Intent** on the Discord Developer Portal Bot page for natural guild-channel messages.

```bash
npx dsh-discord setup
dsh-discord doctor
dsh-discord start

# or managed background mode
dsh-discord start --daemon
dsh-discord status
dsh-discord stop
```

The Bot Token is stored only through DSH Credentials. See [README.zh.md](README.zh.md), [DESIGN.md](DESIGN.md), and [SECURITY.md](SECURITY.md).
