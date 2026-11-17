import type { Inputs } from './inputs.js'
import { type Fetch, RequestError, failureFor, requestJson } from './http.js'

export const DEPLOY_PATH = '/api/deploy/github'
export const STATUS_PATH = '/api/deploy/github/status'

// The platform answers waiting only to a deployment that asked for a hold.
export const TERMINAL_STATES = ['ready', 'failed', 'superseded', 'waiting'] as const
const STATES = ['pending', ...TERMINAL_STATES] as const

export type ReleaseState = (typeof STATES)[number]
export type TerminalState = (typeof TERMINAL_STATES)[number]

export interface Deployment {
  operation: string
  state: ReleaseState
  release: number | undefined
  detail: string | undefined
}

export function isTerminal(state: ReleaseState): state is TerminalState {
  return state !== 'pending'
}

export async function startDeployment(
  inputs: Inputs,
  token: string,
  fetchImpl?: Fetch
): Promise<Deployment> {
  const url = new URL(DEPLOY_PATH, inputs.platformUrl)
  const response = await requestJson(
    {
      url,
      method: 'POST',
      token,
      body: {
        ...inputs.destination,
        image: inputs.image.reference,
        autoDeploy: inputs.autoDeploy
      }
    },
    fetchImpl
  )

  if (response.status !== 200 && response.status !== 202) {
    throw failureFor('the deployment', response)
  }
  return readDeployment(response.payload)
}

export async function readStatus(
  inputs: Inputs,
  operation: string,
  token: string,
  fetchImpl?: Fetch
): Promise<Deployment> {
  const url = new URL(STATUS_PATH, inputs.platformUrl)
  // A query parameter, not a path segment, so the route is one exact path.
  url.searchParams.set('operation', operation)

  const response = await requestJson({ url, method: 'GET', token }, fetchImpl)
  if (response.status !== 200) {
    throw failureFor('the status request', response)
  }
  return readDeployment(response.payload)
}

function readDeployment(payload: Record<string, unknown>): Deployment {
  const operation = payload.operation
  if (typeof operation !== 'string' || operation === '') {
    throw new RequestError('The platform did not return an operation id.')
  }

  const state = payload.state
  if (typeof state !== 'string' || !isState(state)) {
    throw new RequestError(
      `The platform returned the unknown state "${String(state)}". Upgrade the action.`
    )
  }

  return {
    operation,
    state,
    release: typeof payload.release === 'number' ? payload.release : undefined,
    detail: typeof payload.detail === 'string' && payload.detail !== '' ? payload.detail : undefined
  }
}

function isState(value: string): value is ReleaseState {
  return (STATES as readonly string[]).includes(value)
}
