import { type Deployment, isTerminal } from './api.js'
import { RequestError } from './http.js'

export class TimeoutError extends Error {}

export interface Clock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
}

// A deployment in flight must survive a bad gateway or a dropped connection.
// It must not survive a platform that is down, so the tolerance is bounded and
// resets on the first answer.
export const MAX_CONSECUTIVE_FAILURES = 3

export interface WaitOptions {
  pollIntervalMs: number
  timeoutMs: number
  clock?: Clock
  onRetry?: (error: RequestError, attempt: number) => void
}

export async function waitForRelease(
  read: () => Promise<Deployment>,
  options: WaitOptions
): Promise<Deployment> {
  const clock = options.clock ?? systemClock
  const deadline = clock.now() + options.timeoutMs
  let failures = 0
  let lastSeen: Deployment | undefined

  for (;;) {
    try {
      const deployment = await read()
      failures = 0
      lastSeen = deployment
      if (isTerminal(deployment.state)) {
        return deployment
      }
    } catch (error) {
      if (!(error instanceof RequestError) || !error.retryable) {
        throw error
      }
      failures += 1
      if (failures > MAX_CONSECUTIVE_FAILURES) {
        throw error
      }
      options.onRetry?.(error, failures)
    }

    if (clock.now() >= deadline) {
      throw new TimeoutError(
        `The release ${describe(lastSeen)} after ${options.timeoutMs / 1000} seconds. The deployment is still running on the platform; raise the timeout input or look at the environment in the console.`
      )
    }
    await clock.sleep(options.pollIntervalMs)
  }
}

function describe(deployment: Deployment | undefined): string {
  if (deployment === undefined) {
    return 'did not report a state'
  }
  if (deployment.release === undefined) {
    return `was still ${deployment.state}`
  }
  return `${deployment.release} was still ${deployment.state}`
}
