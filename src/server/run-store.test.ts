import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalHermesHome = process.env.HERMES_HOME

let tempHome: string | null = null

beforeEach(() => {
  vi.resetModules()
  tempHome = mkdtempSync(join(tmpdir(), 'hermes-run-store-'))
  process.env.HERMES_HOME = tempHome
})

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true })
  tempHome = null
  if (originalHermesHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHermesHome
  vi.useRealTimers()
  vi.resetModules()
})

describe('run-store persistence', () => {
  it('reports old non-terminal runs as stalled so reload polling can clear waiting UI', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T21:00:00.000Z'))

    const { createPersistedRun, getActiveRunForSession } =
      await import('./run-store')

    await createPersistedRun({ runId: 'run-stale', sessionKey: 'session-1' })

    vi.setSystemTime(new Date('2026-05-20T21:06:00.000Z'))

    const activeRun = await getActiveRunForSession('session-1')
    expect(activeRun?.runId).toBe('run-stale')
    expect(activeRun?.status).toBe('stalled')
    vi.useRealTimers()
  })

  it('keeps recent non-terminal runs active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T21:00:00.000Z'))

    const { createPersistedRun, getActiveRunForSession } =
      await import('./run-store')

    await createPersistedRun({ runId: 'run-fresh', sessionKey: 'session-1' })

    vi.setSystemTime(new Date('2026-05-20T21:04:59.000Z'))

    const activeRun = await getActiveRunForSession('session-1')
    expect(activeRun?.runId).toBe('run-fresh')
    expect(activeRun?.status).toBe('accepted')
    vi.useRealTimers()
  })

  it('preserves concurrent updates to the same run', async () => {
    const { addRunLifecycleEvent, createPersistedRun, getPersistedRun } =
      await import('./run-store')

    await createPersistedRun({ runId: 'run-1', sessionKey: 'session-1' })

    const events = Array.from({ length: 24 }, (_, index) => ({
      text: `event-${index}`,
      emoji: '',
      timestamp: index,
      isError: false,
    }))

    await Promise.all(
      events.map((event) => addRunLifecycleEvent('session-1', 'run-1', event)),
    )

    const stored = await getPersistedRun('session-1', 'run-1')
    expect(stored?.lifecycleEvents.map((event) => event.text).sort()).toEqual(
      events.map((event) => event.text).sort(),
    )
  })
})
