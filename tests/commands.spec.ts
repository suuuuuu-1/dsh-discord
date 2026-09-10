import { describe, expect, it } from 'vitest'
import { DSH_COMMAND_BODY, MODEL_COMMAND_BODY } from '../src/discord/commands.js'

describe('Discord commands', () => {
  it('publishes the discoverable help subcommand', () => {
    expect(DSH_COMMAND_BODY.options?.map(option => option.name)).toContain('help')
  })

  it('publishes a global /model command with status, list, and set subcommands', () => {
    expect(MODEL_COMMAND_BODY.name).toBe('model')
    const options = MODEL_COMMAND_BODY.options ?? []
    expect(options.map(option => option.name)).toEqual(['status', 'list', 'set'])
    const set = options.find(option => option.name === 'set') as { options?: Array<{ name: string; required?: boolean }> }
    expect(set.options?.find(option => option.name === 'spec')?.required).toBe(true)
  })
})
