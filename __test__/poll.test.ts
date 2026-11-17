import { describe, expect, test } from '@jest/globals'
import type { Deployment, ReleaseState } from '../src/api.js'
import { RequestError } from '../src/http.js'
import { type Clock, MAX_CONSECUTIVE_FAILURES, TimeoutError, waitForRelease } from '../src/poll.js'

function deployment(state: ReleaseState, release = 1): Deployment {
  return { operation: 'op-1', state, release, detail: undefined }
}

function clock(): Clock & { elapsed: () => number } {
  let time = 0
  return {
    now: () => time,
    sleep: async ms => {
      time += ms
    },
    elapsed: () => time
  }
}

const options = { pollIntervalMs: 5000, timeoutMs: 60000 }

describe('waitForRelease', () => {
  test('returns at once when the first read is terminal', async () => {
    let reads = 0
    const result = await waitForRelease(
      async () => {
        reads += 1
        return deployment('ready')
      },
      { ...options, clock: clock() }
    )
    expect(result.state).toBe('ready')
    expect(reads).toBe(1)
  })

  test('polls until the release becomes ready', async () => {
    const states: ReleaseState[] = ['pending', 'pending', 'ready']
    let reads = 0
    const result = await waitForRelease(async () => deployment(states[reads++]!), {
      ...options,
      clock: clock()
    })
    expect(result.state).toBe('ready')
    expect(reads).toBe(3)
  })

  test('returns a failure rather than raising it, so outputs can be published', async () => {
    const result = await waitForRelease(async () => deployment('failed'), {
      ...options,
      clock: clock()
    })
    expect(result.state).toBe('failed')
  })

  test('returns superseded as a terminal state', async () => {
    const result = await waitForRelease(async () => deployment('superseded'), {
      ...options,
      clock: clock()
    })
    expect(result.state).toBe('superseded')
  })

  test('waits the poll interval between reads', async () => {
    const c = clock()
    const states: ReleaseState[] = ['pending', 'pending', 'ready']
    let reads = 0
    await waitForRelease(async () => deployment(states[reads++]!), { ...options, clock: c })
    expect(c.elapsed()).toBe(10000)
  })

  test('gives up at the timeout and says the deployment is still running', async () => {
    await expect(
      waitForRelease(async () => deployment('pending'), {
        pollIntervalMs: 5000,
        timeoutMs: 20000,
        clock: clock()
      })
    ).rejects.toThrow(TimeoutError)
  })

  test('names the last state and release in the timeout message', async () => {
    await expect(
      waitForRelease(async () => deployment('pending', 42), {
        pollIntervalMs: 5000,
        timeoutMs: 20000,
        clock: clock()
      })
    ).rejects.toThrow(/42 was still pending/)
  })

  test('survives a retryable failure and keeps polling', async () => {
    let reads = 0
    const result = await waitForRelease(
      async () => {
        reads += 1
        if (reads <= MAX_CONSECUTIVE_FAILURES) {
          throw new RequestError('bad gateway', true)
        }
        return deployment('ready')
      },
      { ...options, clock: clock() }
    )
    expect(result.state).toBe('ready')
  })

  test('gives up once the failures pass the bound', async () => {
    await expect(
      waitForRelease(
        async () => {
          throw new RequestError('bad gateway', true)
        },
        { ...options, clock: clock() }
      )
    ).rejects.toThrow(/bad gateway/)
  })

  test('resets the failure count after an answer', async () => {
    const script: (ReleaseState | 'error')[] = [
      'error',
      'error',
      'error',
      'pending',
      'error',
      'error',
      'error',
      'ready'
    ]
    let reads = 0
    const result = await waitForRelease(
      async () => {
        const step = script[reads++]!
        if (step === 'error') {
          throw new RequestError('bad gateway', true)
        }
        return deployment(step)
      },
      { pollIntervalMs: 1000, timeoutMs: 600000, clock: clock() }
    )
    expect(result.state).toBe('ready')
  })

  test('raises a refusal at once, because retrying it changes nothing', async () => {
    let reads = 0
    await expect(
      waitForRelease(
        async () => {
          reads += 1
          throw new RequestError('the platform refused the status request (403)', false)
        },
        { ...options, clock: clock() }
      )
    ).rejects.toThrow(/403/)
    expect(reads).toBe(1)
  })

  test('reports each retry so the log shows why a deployment is slow', async () => {
    const seen: number[] = []
    let reads = 0
    await waitForRelease(
      async () => {
        reads += 1
        if (reads === 1) {
          throw new RequestError('bad gateway', true)
        }
        return deployment('ready')
      },
      { ...options, clock: clock(), onRetry: (_error, attempt) => seen.push(attempt) }
    )
    expect(seen).toEqual([1])
  })
})
