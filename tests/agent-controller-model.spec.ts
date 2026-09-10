import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { AgentController, DiscordInputError } from '../src/bridge/agent-controller.js'
import { FakeDiscordTransport } from '../src/discord/fake.js'
import { StateStore } from '../src/state/store.js'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))))

const DEFAULT_MODEL = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

function idleAgent(id: string): Agent {
  return {
    id, session: { id, seq: 0 }, status: 'idle',
    followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
}

interface Harness {
  ctx: Context
  state: StateStore
  controller: AgentController
  saved: { provider: string; model: string }
  create: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  saveSelection: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-model-'))
  directories.push(directory)
  const state = new StateStore(join(directory, 'state.json'))
  await state.touchConversation({ channelId: 'dm', kind: 'dm' })
  const saved = { ...DEFAULT_MODEL }
  const dispose = vi.fn().mockResolvedValue(undefined)
  const resumeDispose = vi.fn().mockResolvedValue(undefined)
  const create = vi.fn().mockResolvedValue({ agent: idleAgent('discord-open'), dispose } as unknown as AgentHandle)
  const resume = vi.fn().mockResolvedValue({ agent: idleAgent('discord-open'), dispose: resumeDispose } as unknown as AgentHandle)
  const saveSelection = vi.fn(async (next: { provider: string; model: string }) => {
    saved.provider = next.provider
    saved.model = next.model
  })
  const ctx = {
    agents: { create, resume },
    sessions: { flush: vi.fn().mockResolvedValue(undefined) },
    attachments: {
      imageLimits: { maxImageBytes: 10_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 20_000_000 },
      validateImage: vi.fn(), saveImage: vi.fn(),
    },
    agentDefaultModel: {
      currentSelection: () => ({ ...saved }),
      saveSelection,
    },
  } as unknown as Context
  const controller = new AgentController(ctx, directory, state, new FakeDiscordTransport(), 10)
  return { ctx, state, controller, saved, create, resume, saveSelection, dispose }
}

describe('AgentController model switching', () => {
  it('switches within the same provider by mutating the live selection without releasing the Agent', async () => {
    const { controller, state, saved, create, dispose } = await harness()
    await controller.submit('hello', 'dm')
    expect(state.conversation('dm')?.sessionId).toBeDefined()

    const reply = await controller.switchModel('dm', 'deepseek-official/deepseek-v4-pro')

    expect(saved).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(reply).toContain('deepseek-v4-pro')
    expect(reply).toContain('下一次消息生效')
    expect(dispose).not.toHaveBeenCalled()

    await controller.submit('again', 'dm')
    expect(create).toHaveBeenCalledOnce()
    await controller.dispose()
    await state.close()
  })

  it('persists the default, releases the Agent, and keeps the Session on a cross-provider switch', async () => {
    const { controller, state, saved, create, resume, dispose } = await harness()
    await controller.submit('hello', 'dm')
    const sessionId = state.conversation('dm')?.sessionId
    expect(sessionId).toBeDefined()

    const reply = await controller.switchModel('dm', 'ollama/glm-5.2:cloud')

    expect(saved).toEqual({ provider: 'ollama', model: 'glm-5.2:cloud' })
    expect(reply).toContain('glm-5.2:cloud')
    expect(reply).toContain('新提供商上继续')
    expect(dispose).toHaveBeenCalledOnce()
    expect(state.conversation('dm')?.sessionId).toBe(sessionId)

    await controller.submit('after', 'dm')
    expect(resume).toHaveBeenCalledOnce()
    expect(String(resume.mock.calls[0]?.[0]?.resumeSessionId)).toBe(sessionId)
    expect(create).toHaveBeenCalledOnce()
    await controller.dispose()
    await state.close()
  })

  it('rejects an unknown or bare spec with a DiscordInputError and does not persist it', async () => {
    const { controller, state, saved, saveSelection } = await harness()
    await expect(controller.switchModel('dm', 'acme/deepseek-v4-flash')).rejects.toBeInstanceOf(DiscordInputError)
    await expect(controller.switchModel('dm', 'deepseek-v4-flash')).rejects.toBeInstanceOf(DiscordInputError)
    expect(saveSelection).not.toHaveBeenCalled()
    expect(saved).toEqual(DEFAULT_MODEL)
    await controller.dispose()
    await state.close()
  })

  it('reports the live conversation model and the saved default', async () => {
    const { controller, state } = await harness()
    const status = controller.modelStatus('dm')
    expect(status).toContain('deepseek-official/deepseek-v4-flash')
    expect(status).toContain('DeepSeek V4 Flash')
    await controller.dispose()
    await state.close()
  })
})
