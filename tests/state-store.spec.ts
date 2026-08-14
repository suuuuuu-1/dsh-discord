import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from '../src/state/store.js'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))))

describe('StateStore', () => {
  it('claims events durably before work and bounds the dedupe window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-state-'))
    directories.push(directory)
    const filename = join(directory, 'state.json')
    const store = new StateStore(filename, 2)
    expect(await store.claimEvent('a')).toBe(true)
    expect(await store.claimEvent('a')).toBe(false)
    await store.claimEvent('b')
    await store.claimEvent('c')
    await store.touchConversation({ channelId: 'dm', kind: 'dm' })
    await store.setSessionId('dm', 'session')
    await store.touchConversation({ channelId: 'thread', guildId: 'guild', kind: 'thread' })
    await store.setSessionId('thread', 'thread-session')
    await store.close()
    expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({
      version: 2,
      conversations: {
        dm: { channelId: 'dm', kind: 'dm', sessionId: 'session' },
        thread: { channelId: 'thread', guildId: 'guild', kind: 'thread', sessionId: 'thread-session' },
      },
      seenEventIds: ['b', 'c'],
    })
    const restored = new StateStore(filename, 2)
    await restored.load()
    expect(await restored.claimEvent('c')).toBe(false)
    expect(restored.conversation('thread')?.sessionId).toBe('thread-session')
    await restored.close()
  })

  it('migrates the DM-only v1 document without losing its Session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-state-'))
    directories.push(directory)
    const filename = join(directory, 'state.json')
    await writeFile(filename, JSON.stringify({ version: 1, channelId: 'old-dm', sessionId: 'old-session', seenEventIds: ['old'] }))
    const store = new StateStore(filename)
    await store.load()
    expect(store.conversation('old-dm')).toEqual({ channelId: 'old-dm', kind: 'dm', sessionId: 'old-session' })
    expect(await store.claimEvent('old')).toBe(false)
    await store.close()
  })
})
