# dsh-discord Design

## Product boundary

`dsh-discord` is an out-of-tree DSH bundle and a personal remote coding-agent controller. One configured Discord owner can use one configured project from DMs, guild text channels, and threads visible to the Bot. It does not patch the DSH agent loop or install into the `web` profile.

The bridge drives only public seams: `ctx.agents.create/resume`, `agent.followup/steer/cancel`, `session/event`, `approval/request`, `ctx.userQuestions`, `ctx.attachments`, and `ctx.credentials`.

## Discord transport

Stable `discord.js` v14 owns Gateway heartbeat/resume/reconnect, REST rate limits, application commands, buttons, selects, modals, attachments, and message editing. Production requests `Guilds`, `GuildMessages`, `DirectMessages`, and `MessageContent`; natural guild-channel text therefore requires the Developer Portal Message Content Intent toggle.

`DiscordTransport` is deliberately narrow and has an in-memory fake for deterministic tests. Every outbound payload disables mention parsing.

## Conversation mapping

```text
configured projectRoot            -> DSH workspace
authorized owner + Discord channel -> one live/recoverable Agent
DM / text channel / thread id      -> one persisted DSH Session id
```

Discord snowflake channel IDs are globally unique, so a channel ID is the durable conversation key. Threads naturally receive a separate key and Session. State v2 stores conversation metadata plus a bounded global event-ID dedupe window. State v1 is migrated in memory without losing the existing DM Session.

An event ID is persisted before side effects. Attachments remain lazy until identity authorization and dedupe have both succeeded.

## Agent ownership and concurrency

`AgentController` owns the exact `AgentHandle` for each active conversation. Agent creation/resume is serialized per conversation while different channels can run concurrently. Each Agent installs the current default model selection during unpublished setup and uses the fixed validated `projectRoot` as `cwd`.

Owner DMs call `followup` directly. Guild-channel text requires an explicit bot mention; a thread requires a mention only until it owns a persisted or live Session. DSH queues later `followup` calls when the Agent is running. Per-conversation delivery serialization plus generation-aware idle settlement keeps queued turns on the same reporter without replacing a turn record. `/dsh steer` alone calls `steer`, `/dsh stop` cancels only the current conversation, and `/dsh new` replaces only that conversation's handle and Session.

Session events are routed back by exact Agent/session identity. Approvals and questions also resolve the owning Agent back to its Discord channel, so concurrent conversations cannot receive one another's interaction.

## Attachment ingress

Discord CDN bytes are downloaded with a 25 MiB transport ceiling only after authorization. PNG/JPEG/WebP/GIF inputs are batch-validated and persisted through `ctx.attachments` before a user message event is published. UTF-8 text and common source-code files are embedded in bounded tagged text blocks (512 KiB each, 1 MiB total). General binary persistence is intentionally not invented because the current DSH attachment seam only defines durable raster images.

## Output and interactions

Only committed `assistant/message`, `tool/call`, and `turn/end` events affect Discord. Hidden reasoning and token chunks are never forwarded. One editable progress message is rate-coalesced, tool updates show only names, and the final result either stays inline or becomes `dsh-result.md`.

Approval and question callback IDs are random, in-memory, one-shot, owner-authenticated, and expiring. Timeout, abort, Agent cancellation, transport failure, or plugin teardown safely settles pending interactions.

## Credentials and operation

Ordinary config contains only `tokenRef: DSH_DISCORD_BOT_TOKEN`. Setup passes a secret to a one-shot mounted profile which writes through `ctx.credentials.set`; runtime and doctor resolve through the same seam. Errors are classified without printing Discord or network error bodies.

The CLI supports foreground operation and a managed daemon with a PID document and per-run stdout/stderr logs under `$DSH_HOME/dsh-discord`. `setup` and `doctor` share one permission definition including `SendMessagesInThreads`; diagnostics verify DSH services, credential resolution, Gateway login, global command registration, joined guild count, writable text-channel count, and project access.

## Verification

Keyless tests cover owner policy, guild/thread routing, per-conversation state and v1 migration, durable dedupe, lazy unauthorized attachments, DSH image persistence, UTF-8 source attachments, Agent followup/final output, progress coalescing, approvals, structured questions, teardown, and mention suppression. Real-token acceptance covers Gateway/intent behavior, commands, Discord permissions, reconnect, and live message delivery.
