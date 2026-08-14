import { randomUUID } from 'node:crypto'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { DiscordInboundEvent, DiscordInteractionResponse, DiscordSentMessage, DiscordTransport } from '../discord/types.js'
import type { AgentController } from '../bridge/agent-controller.js'
import { suppressMentions } from '../bridge/renderer.js'

interface PendingApproval {
  resolve(outcome: ApprovalOutcome): void
  timer: NodeJS.Timeout
  message?: DiscordSentMessage
  settled: boolean
}

/** One-shot, owner-routed approval answerer with expiry and teardown cancellation. */
export class ApprovalInteraction {
  private readonly pending = new Map<string, PendingApproval>()
  private closed = false

  constructor(
    private readonly transport: DiscordTransport,
    private readonly controller: AgentController,
    private readonly timeoutMs: number,
  ) {}

  request(request: ApprovalRequest): Promise<ApprovalOutcome> | undefined {
    if (this.closed || !this.controller.owns(request.agent)) return undefined
    const channelId = this.controller.currentChannel(request.agent)
    if (channelId === undefined || request.signal?.aborted) return Promise.resolve('cancelled')
    const nonce = randomUUID()
    return new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = {
        resolve,
        settled: false,
        timer: setTimeout(() => { this.settle(nonce, 'unavailable', '⌛ 审批请求已过期。') }, this.timeoutMs),
      }
      this.pending.set(nonce, pending)
      const detail = request.reason === undefined ? '' : `\n原因：${suppressMentions(request.reason)}`
      void this.transport.send(channelId, {
        content: `🔐 工具审批：${suppressMentions(request.toolName)}${detail}`,
        buttons: [
          { customId: `dsh:a:${nonce}:allow`, label: '允许一次', style: 'success' },
          { customId: `dsh:a:${nonce}:reject`, label: '拒绝', style: 'danger' },
        ],
      }).then(message => { pending.message = message }, () => { this.settle(nonce, 'unavailable', '审批界面不可用。') })
      if (request.signal !== undefined) {
        request.signal.addEventListener('abort', () => {
          this.settle(nonce, 'cancelled', '⏹️ 审批请求已取消。')
        }, { once: true })
      }
    })
  }

  handle(event: DiscordInboundEvent): DiscordInteractionResponse | undefined {
    if (event.kind !== 'component') return undefined
    const match = /^dsh:a:([^:]+):(allow|reject)$/.exec(event.customId)
    if (match === null) return undefined
    const nonce = match[1]!
    if (!this.pending.has(nonce)) return { kind: 'reply', content: '该审批请求不存在或已过期。' }
    const allowed = match[2] === 'allow'
    this.settle(nonce, allowed ? 'allowed-once' : 'rejected', allowed ? '✅ 已允许一次。' : '🚫 已拒绝。')
    return { kind: 'update', content: allowed ? '✅ 已允许一次。' : '🚫 已拒绝。' }
  }

  dispose(): void {
    this.closed = true
    for (const nonce of [...this.pending.keys()]) this.settle(nonce, 'cancelled', '⏹️ 插件已卸载，审批请求已取消。')
  }

  private settle(nonce: string, outcome: ApprovalOutcome, content: string): void {
    const pending = this.pending.get(nonce)
    if (pending === undefined || pending.settled) return
    pending.settled = true
    this.pending.delete(nonce)
    clearTimeout(pending.timer)
    pending.resolve(outcome)
    if (pending.message !== undefined) {
      void this.transport.edit(pending.message, { content, buttons: [] }).catch(() => undefined)
    }
  }
}
