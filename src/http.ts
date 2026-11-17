import { VERSION } from './version.js'

export class RequestError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

export const VERSION_HEADER = 'x-apervia-action-version'

export const MAX_RESPONSE_BYTES = 64 * 1024
export const REQUEST_TIMEOUT_MS = 30_000

// Longer than any error the platform returns, short enough that a proxy's HTML
// page cannot fill the log.
const MAX_DETAIL_LENGTH = 200

const TOO_MANY_REQUESTS = 429

export interface JsonRequest {
  url: URL
  method: 'GET' | 'POST'
  token: string
  body?: unknown
}

export interface JsonResponse {
  status: number
  payload: Record<string, unknown>
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export async function requestJson(
  request: JsonRequest,
  fetchImpl: Fetch = globalThis.fetch
): Promise<JsonResponse> {
  const headers: Record<string, string> = {
    // The token travels here and nowhere else. A URL is logged by proxies and
    // kept in history; a header is not.
    authorization: `Bearer ${request.token}`,
    accept: 'application/json',
    [VERSION_HEADER]: VERSION
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    // Manual, not 'error': a redirect is then an ordinary response this code
    // refuses by status, with a message that says what happened.
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }

  if (request.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(request.body)
  }

  let response: Response
  try {
    response = await fetchImpl(request.url.toString(), init)
  } catch (error) {
    throw new RequestError(`Could not reach ${request.url.origin}: ${describe(error)}.`, true)
  }

  if (response.status >= 300 && response.status < 400) {
    throw new RequestError(
      `${request.url.origin} answered with a redirect, which is refused. Check that platform-url names the deployment origin directly.`
    )
  }

  const text = await readBounded(response)
  return { status: response.status, payload: parse(text, response.status) }
}

async function readBounded(response: Response): Promise<string> {
  if (response.body === null) {
    return ''
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value === undefined) {
        continue
      }
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new RequestError(`The response is larger than ${MAX_RESPONSE_BYTES} bytes.`)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parse(text: string, status: number): Record<string, unknown> {
  if (text.trim() === '') {
    return {}
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new RequestError(
      `The platform answered ${status} with something that is not JSON: ${truncate(text)}`,
      retryableStatus(status)
    )
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(`The platform answered ${status} with an unexpected JSON value.`)
  }
  return value as Record<string, unknown>
}

/**
 * Turn a non-2xx response into an error the user can act on.
 *
 * The platform returns generic messages on purpose, so this adds what the
 * action knows and the platform cannot: which request was refused.
 */
export function failureFor(what: string, response: JsonResponse): RequestError {
  const detail = typeof response.payload.error === 'string' ? response.payload.error : ''
  const suffix = detail === '' ? '' : `: ${truncate(detail)}`

  if (response.status === 401 || response.status === 403) {
    return new RequestError(
      `The platform refused ${what} (${response.status})${suffix}. Check that a deployment trust exists for this repository, this environment and this image.`
    )
  }
  if (response.status === 404) {
    return new RequestError(
      `The platform has no such deployment route or operation (404)${suffix}.`
    )
  }
  return new RequestError(
    `The platform refused ${what} (${response.status})${suffix}.`,
    retryableStatus(response.status)
  )
}

// A 5xx is the platform's problem and may pass, and so is a 429: a busy
// platform is no reason to fail a release that is rolling out correctly. Every
// other 4xx is this request's problem and will not pass.
function retryableStatus(status: number): boolean {
  return status === TOO_MANY_REQUESTS || status >= 500
}

function truncate(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > MAX_DETAIL_LENGTH ? `${clean.slice(0, MAX_DETAIL_LENGTH)}…` : clean
}

function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`
  }
  return error instanceof Error ? error.message : 'the request failed'
}
