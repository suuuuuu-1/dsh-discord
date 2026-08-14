# Security Policy

`dsh-discord` is a personal coding-agent controller. It requires an exact Discord Owner ID and an accessible configured project directory before any Discord event can drive an Agent. It accepts that owner in DMs, guild text channels, and threads that Discord itself exposes to the Bot; it does not duplicate Discord's Guild/Channel/role permission system with another allowlist.

The Discord Bot Token is represented in ordinary configuration only by the `DSH_DISCORD_BOT_TOKEN` credential reference. It is stored and resolved through DSH `ctx.credentials` and must never appear in normal config, logs, bridge state, Session events, or error messages.

Discord attachment bytes are fetched lazily only after owner authorization and event deduplication. Images are validated and persisted through the DSH attachment seam. Text/code files are size-bounded and decoded as strict UTF-8. Unsupported binary files are rejected and are never written into the project workspace.

Approval callbacks are authenticated by owner, routed to the exact live Agent and Discord conversation, bound to one pending request, single-use, and expiring. Unknown, duplicate, expired, aborted, or teardown-time callbacks fail closed.

Agent-controlled output is sent with all Discord mentions disabled. The renderer additionally neutralizes `@everyone`, `@here`, user mentions, and role mentions.

Please report vulnerabilities privately to the repository owner. Do not include live credentials, private Session logs, or sensitive workspace content in a report.
