import { describe, expect, test } from '@jest/globals'
import {
  type Fetch,
  MAX_RESPONSE_BYTES,
  RequestError,
  VERSION_HEADER,
  failureFor,
  requestJson
} from '../src/http.js'
import { VERSION } from '../src/version.js'

interface Call {
  url: string
  init: RequestInit
}

function transport(make: () => Response): { calls: Call[]; impl: Fetch } {
  const calls: Call[] = []
  const impl: Fetch = async (url, init) => {
    calls.push({ url, init })
    return make()
  }
  return { calls, impl }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>
}

const URL_UNDER_TEST = new URL('https://admin.example.com/api/deploy/github')

describe('requestJson', () => {
  test('carries the token in the authorization header', async () => {
    const t = transport(() => json({ ok: true }))
    await requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    expect(headersOf(t.calls[0]!).authorization).toBe('Bearer a.b.c')
  })

  test('never puts the token in the url', async () => {
    const t = transport(() => json({ ok: true }))
    await requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    expect(t.calls[0]!.url).not.toContain('a.b.c')
    expect(t.calls[0]!.url).toBe('https://admin.example.com/api/deploy/github')
  })

  test('reports the action version, so the platform can drive a deprecation', async () => {
    const t = transport(() => json({ ok: true }))
    await requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    expect(headersOf(t.calls[0]!)[VERSION_HEADER]).toBe(VERSION)
  })

  test('sends a json body on a post and none on a get', async () => {
    const t = transport(() => json({ ok: true }))
    await requestJson(
      { url: URL_UNDER_TEST, method: 'POST', token: 'a.b.c', body: { image: 'x' } },
      t.impl
    )
    expect(t.calls[0]!.init.body).toBe('{"image":"x"}')
    expect(headersOf(t.calls[0]!)['content-type']).toBe('application/json')

    await requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    expect(t.calls[1]!.init.body).toBeUndefined()
  })

  test('refuses to follow a redirect', async () => {
    const t = transport(
      () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } })
    )
    await expect(
      requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    ).rejects.toThrow(/redirect, which is refused/)
    expect(t.calls[0]!.init.redirect).toBe('manual')
  })

  test('refuses a response larger than the cap', async () => {
    const t = transport(() => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))
    await expect(
      requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    ).rejects.toThrow(/larger than/)
  })

  test('accepts a response at the cap', async () => {
    const payload = { detail: 'y'.repeat(MAX_RESPONSE_BYTES - 20) }
    const t = transport(() => json(payload))
    const response = await requestJson(
      { url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' },
      t.impl
    )
    expect(response.status).toBe(200)
  })

  test('refuses a body that is not json', async () => {
    const t = transport(() => new Response('<html>gateway timeout</html>', { status: 504 }))
    await expect(
      requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    ).rejects.toThrow(/not JSON/)
  })

  test('refuses a json array, which is not a payload', async () => {
    const t = transport(() => json([1, 2, 3]))
    await expect(
      requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, t.impl)
    ).rejects.toThrow(/unexpected JSON value/)
  })

  test('treats an empty body as an empty payload', async () => {
    const t = transport(() => new Response('', { status: 200 }))
    const response = await requestJson(
      { url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' },
      t.impl
    )
    expect(response.payload).toEqual({})
  })

  test('marks a transport failure retryable, because a poll should survive one', async () => {
    const impl: Fetch = async () => {
      throw new Error('socket hang up')
    }
    await expect(
      requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, impl)
    ).rejects.toMatchObject({ retryable: true })
  })

  test('names the origin, not the full url, when the platform is unreachable', async () => {
    const impl: Fetch = async () => {
      throw new Error('socket hang up')
    }
    await expect(
      requestJson({ url: URL_UNDER_TEST, method: 'GET', token: 'a.b.c' }, impl)
    ).rejects.toThrow(/https:\/\/admin\.example\.com/)
  })
})

describe('failureFor', () => {
  test('points a refusal at the deployment trust', () => {
    const error = failureFor('the deployment', { status: 403, payload: {} })
    expect(error.message).toMatch(/deployment trust/)
    expect(error.retryable).toBe(false)
  })

  test('includes the platform detail when there is one', () => {
    const error = failureFor('the deployment', { status: 403, payload: { error: 'no trust' } })
    expect(error.message).toContain('no trust')
  })

  test('marks a server error retryable and a client error not', () => {
    expect(failureFor('x', { status: 503, payload: {} }).retryable).toBe(true)
    expect(failureFor('x', { status: 400, payload: {} }).retryable).toBe(false)
    expect(failureFor('x', { status: 404, payload: {} }).retryable).toBe(false)
  })

  test('marks a busy platform retryable, so a shared bound cannot fail a good release', () => {
    expect(failureFor('the status request', { status: 429, payload: {} }).retryable).toBe(true)
  })

  test('truncates a long detail rather than filling the log', () => {
    const error = failureFor('x', { status: 500, payload: { error: 'z'.repeat(5000) } })
    expect(error.message.length).toBeLessThan(400)
  })

  test('is a RequestError, so main reports it as written', () => {
    expect(failureFor('x', { status: 500, payload: {} })).toBeInstanceOf(RequestError)
  })
})
