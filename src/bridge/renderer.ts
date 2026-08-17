import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DiscordMessagePayload } from '../discord/types.js'

const DISCORD_MESSAGE_LIMIT = 2000
const INLINE_RESULT_LIMIT = 1750

/** Neutralize Discord mention syntax in Agent-controlled text. */
export function suppressMentions(text: string): string {
  return text
    .replaceAll('@everyone', '@\u200beveryone')
    .replaceAll('@here', '@\u200bhere')
    .replace(/<@([!&]?\d+)>/g, '<@\u200b$1>')
}

/** Keep arbitrary DSH text inside Discord's content limit without splitting a surrogate pair. */
export function boundedDiscordText(text: string, limit = DISCORD_MESSAGE_LIMIT): string {
  const safe = suppressMentions(text)
  if (safe.length <= limit) return safe
  let prefix = safe.slice(0, Math.max(0, limit - 1))
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1)
  return `${prefix.trimEnd()}…`
}

/** Extract only committed assistant-visible text, excluding reasoning chunks. */
export function assistantText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Render a completed result inline or as a Markdown attachment. */
export function finalPayload(text: string, status: 'completed' | 'cancelled' | 'failed'): DiscordMessagePayload {
  const safe = suppressMentions(text.trim())
  const prefix = status === 'completed' ? '✅ 已完成' : status === 'cancelled' ? '⏹️ 已停止' : '❌ 任务失败'
  if (safe.length === 0) return { content: prefix }
  if (`${prefix}\n\n${safe}`.length <= INLINE_RESULT_LIMIT) return { content: `${prefix}\n\n${safe}` }
  return {
    content: `${prefix}\n\n结果较长，已作为 Markdown 文件发送。`,
    file: { name: 'dsh-result.md', data: new TextEncoder().encode(safe) },
  }
}

/** Bound status content below Discord's hard message limit. */
export function statusPayload(content: string): DiscordMessagePayload {
  return { content: boundedDiscordText(content) }
}
