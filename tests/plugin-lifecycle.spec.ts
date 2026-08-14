import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.js'

describe('plugin lifecycle', () => {
  it('mounts synchronously instead of deadlocking on Loader settlement', async () => {
    const neverSettles = new Promise<void>(() => undefined)
    const exit = vi.fn()
    const effect = vi.fn()
    const get = vi.fn((name: string) => {
      if (name === 'loader') return { await: () => neverSettles }
      if (name === 'appExit') return exit
      return undefined
    })
    const config: Config = {
      tokenRef: 'DSH_DISCORD_BOT_TOKEN',
      statePath: 'state.json',
    }

    const result = apply({ get, effect } as never, config)

    expect(result).toBeUndefined()
    expect(effect).toHaveBeenCalledOnce()
    const installEffect = effect.mock.calls[0]?.[0] as (() => () => void) | undefined
    expect(installEffect).toBeTypeOf('function')
    await installEffect?.()()
    expect(exit).not.toHaveBeenCalled()
  })
})
