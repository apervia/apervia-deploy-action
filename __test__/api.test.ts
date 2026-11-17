import { describe, expect, test } from '@jest/globals'
import { DEPLOY_PATH, STATUS_PATH, isTerminal, readStatus, startDeployment } from '../src/api.js'
import type { Fetch } from '../src/http.js'
import type { Inputs } from '../src/inputs.js'

const DIGEST = `sha256:${'a'.repeat(64)}`

const inputs: Inputs = {
  destination: { target: 'env_abcdefghijklmnopqrst' },
  image: {
    repository: 'ghcr.io/acme/widget',
    host: 'ghcr.io',
    digest: DIGEST,
    reference: `ghcr.io/acme/widget@${DIGEST}`
  },
  platformUrl: new URL('https://admin.example.com'),
  pollIntervalMs: 5000,
  timeoutMs: 600000,
  autoDeploy: true
}

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

describe('startDeployment', () => {
  test('posts the target and the image to the deploy route', async () => {
    const t = transport(() => json({ operation: 'op-1', state: 'pending' }, 202))
    await startDeployment(inputs, 'a.b.c', t.impl)

    expect(t.calls[0]!.url).toBe(`https://admin.example.com${DEPLOY_PATH}`)
    expect(t.calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(t.calls[0]!.init.body as string)).toEqual({
      target: 'env_abcdefghijklmnopqrst',
      image: `ghcr.io/acme/widget@${DIGEST}`,
      autoDeploy: true
    })
  })

  test('posts the slugs of a workflow written before targets', async () => {
    const t = transport(() => json({ operation: 'op-1', state: 'pending' }, 202))
    const destination = { application: 'my-app', environment: 'production' }
    await startDeployment({ ...inputs, destination }, 'a.b.c', t.impl)

    expect(JSON.parse(t.calls[0]!.init.body as string)).toEqual({
      application: 'my-app',
      environment: 'production',
      image: `ghcr.io/acme/widget@${DIGEST}`,
      autoDeploy: true
    })
  })

  test('asks for a hold when auto-deploy is false', async () => {
    const t = transport(() => json({ operation: 'op-1', state: 'waiting' }, 202))
    const deployment = await startDeployment({ ...inputs, autoDeploy: false }, 'a.b.c', t.impl)

    expect(JSON.parse(t.calls[0]!.init.body as string).autoDeploy).toBe(false)
    expect(deployment.state).toBe('waiting')
    expect(deployment.release).toBeUndefined()
  })

  test('accepts both 200 and 202', async () => {
    for (const status of [200, 202]) {
      const t = transport(() => json({ operation: 'op-1', state: 'pending' }, status))
      expect((await startDeployment(inputs, 'a.b.c', t.impl)).operation).toBe('op-1')
    }
  })

  test('reads the release and the detail when the platform sends them', async () => {
    const t = transport(() =>
      json({ operation: 'op-1', state: 'ready', release: 42, detail: 'ok' })
    )
    const deployment = await startDeployment(inputs, 'a.b.c', t.impl)
    expect(deployment.release).toBe(42)
    expect(deployment.detail).toBe('ok')
    expect(deployment.state).toBe('ready')
  })

  test('fails when the platform refuses', async () => {
    const t = transport(() => json({ error: 'no trust' }, 403))
    await expect(startDeployment(inputs, 'a.b.c', t.impl)).rejects.toThrow(/deployment trust/)
  })

  test('fails when the platform returns no operation id', async () => {
    const t = transport(() => json({ state: 'pending' }, 202))
    await expect(startDeployment(inputs, 'a.b.c', t.impl)).rejects.toThrow(/operation id/)
  })

  test('fails closed on a state this version does not know', async () => {
    const t = transport(() => json({ operation: 'op-1', state: 'rolling-back' }, 202))
    await expect(startDeployment(inputs, 'a.b.c', t.impl)).rejects.toThrow(/Upgrade the action/)
  })
})

describe('readStatus', () => {
  test('puts the operation in a query parameter so the route stays one exact path', async () => {
    const t = transport(() => json({ operation: 'op-1', state: 'ready', release: 7 }))
    await readStatus(inputs, 'op-1', 'a.b.c', t.impl)

    const url = new URL(t.calls[0]!.url)
    expect(url.pathname).toBe(STATUS_PATH)
    expect(url.searchParams.get('operation')).toBe('op-1')
  })

  test('escapes an operation id rather than letting it shape the url', async () => {
    const t = transport(() => json({ operation: 'x', state: 'ready' }))
    await readStatus(inputs, 'a&b=c', 'a.b.c', t.impl)

    const url = new URL(t.calls[0]!.url)
    expect(url.pathname).toBe(STATUS_PATH)
    expect(url.searchParams.get('operation')).toBe('a&b=c')
  })

  test('fails when the operation does not belong to this caller', async () => {
    const t = transport(() => json({ error: 'not found' }, 404))
    await expect(readStatus(inputs, 'op-1', 'a.b.c', t.impl)).rejects.toThrow(/404/)
  })
})

describe('isTerminal', () => {
  test('treats pending as not terminal and the rest as terminal', () => {
    expect(isTerminal('pending')).toBe(false)
    expect(isTerminal('ready')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('superseded')).toBe(true)
    expect(isTerminal('waiting')).toBe(true)
  })
})
