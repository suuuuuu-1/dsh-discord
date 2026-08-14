import { resolve } from 'node:path'
import type { DiscordInboundEvent } from '../discord/types.js'

/** Validated security configuration for the single-owner, single-project bridge. */
export interface SecurityConfig {
  ownerId?: string
  projectRoot?: string
}

/** Fail-closed Discord identity, scope, and project policy. */
export class SecurityPolicy {
  readonly ownerId: string | undefined
  readonly projectRoot: string | undefined

  constructor(config: SecurityConfig) {
    this.ownerId = nonEmpty(config.ownerId)
    this.projectRoot = nonEmpty(config.projectRoot) === undefined ? undefined : resolve(config.projectRoot!)
  }

  /** Validate static configuration before an agent may be created. */
  configurationError(): string | undefined {
    if (this.ownerId === undefined) return '未配置 Discord Owner，所有请求已拒绝。请运行 dsh-discord setup。'
    if (this.projectRoot === undefined) return '未配置项目目录，所有请求已拒绝。请运行 dsh-discord setup。'
    return undefined
  }

  /** Authorize one inbound event; Discord controls which guild channels reach the bot. */
  authorize(event: DiscordInboundEvent): string | undefined {
    const configured = this.configurationError()
    if (configured !== undefined) return configured
    if (event.userId !== this.ownerId) return '未授权用户。'
    return undefined
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}
