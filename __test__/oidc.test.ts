import { describe, expect, jest, test } from '@jest/globals'
import { AUDIENCE, TokenError, requestToken, type TokenSource } from '../src/oidc.js'

function source(overrides: Partial<TokenSource> = {}): TokenSource & {
  getIDToken: jest.Mock<(audience: string) => Promise<string>>
  setSecret: jest.Mock<(value: string) => void>
} {
  return {
    getIDToken: jest.fn(async () => 'a.b.c'),
    setSecret: jest.fn(),
    ...overrides
  } as never
}

describe('requestToken', () => {
  test('asks for the apervia-deploy audience', async () => {
    const s = source()
    await requestToken(s)
    expect(s.getIDToken).toHaveBeenCalledWith('apervia-deploy')
    expect(AUDIENCE).toBe('apervia-deploy')
  })

  test('masks the token before returning it', async () => {
    const s = source()
    const token = await requestToken(s)
    expect(token).toBe('a.b.c')
    expect(s.setSecret).toHaveBeenCalledWith('a.b.c')
  })

  test('requests a new token on every call, so nothing is cached', async () => {
    let issued = 0
    const s = source({ getIDToken: jest.fn(async () => `token-${++issued}`) as never })
    expect(await requestToken(s)).toBe('token-1')
    expect(await requestToken(s)).toBe('token-2')
    expect(s.getIDToken).toHaveBeenCalledTimes(2)
  })

  test('explains the missing permission when the runner refuses', async () => {
    const s = source({
      getIDToken: jest.fn(async () => {
        throw new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable')
      }) as never
    })
    await expect(requestToken(s)).rejects.toThrow(TokenError)
    await expect(requestToken(s)).rejects.toThrow(/id-token: write/)
  })

  test('does not repeat the underlying failure, which is not written for a user', async () => {
    const s = source({
      getIDToken: jest.fn(async () => {
        throw new Error('ACTIONS_ID_TOKEN_REQUEST_TOKEN=supersecret')
      }) as never
    })
    await expect(requestToken(s)).rejects.not.toThrow(/supersecret/)
  })

  test('refuses an empty token and never masks it', async () => {
    const s = source({ getIDToken: jest.fn(async () => '') as never })
    await expect(requestToken(s)).rejects.toThrow(TokenError)
    expect(s.setSecret).not.toHaveBeenCalled()
  })
})
