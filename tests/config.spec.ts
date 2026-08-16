import { describe, expect, it } from 'vitest'
import { Config, type Config as PluginConfig } from '../src/index.js'

describe('plugin config', () => {
  it('resolves safe infrastructure defaults for generic loader smoke tests', () => {
    // Schemastery's call signature describes the resolved value, while this
    // test intentionally exercises the raw empty loader input used by DSH's
    // marketplace validator.
    expect(Config({} as PluginConfig)).toMatchObject({
      tokenRef: 'DSH_DISCORD_BOT_TOKEN',
      statePath: 'state.json',
      setupMode: false,
      doctorMode: false,
      progressIntervalMs: 1500,
      interactionTimeoutMs: 600000,
    })
  })
})
