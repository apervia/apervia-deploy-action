import * as core from '@actions/core'

// A constant, not a value derived from the request. The server binds a request
// by comparing the application, the environment and the image against the
// trust it holds, so the audience does not need to carry them.
export const AUDIENCE = 'apervia-deploy'

export class TokenError extends Error {}

export interface TokenSource {
  getIDToken(audience: string): Promise<string>
  setSecret(value: string): void
}

const runnerTokenSource: TokenSource = {
  getIDToken: audience => core.getIDToken(audience),
  setSecret: value => core.setSecret(value)
}

/**
 * Request a GitHub OIDC token for the Apervia audience and mask it.
 *
 * Call this immediately before each request. A token is short lived, and the
 * status endpoint verifies a fresh one on every poll.
 */
export async function requestToken(source: TokenSource = runnerTokenSource): Promise<string> {
  let token: string
  try {
    token = await source.getIDToken(AUDIENCE)
  } catch {
    // The underlying message is dropped rather than wrapped. It is written for
    // a runner, not for a user, and this path must never widen into somewhere a
    // credential could be printed.
    throw new TokenError(
      'Could not get a GitHub OIDC token. Give this job "permissions: id-token: write".'
    )
  }

  if (token === '') {
    throw new TokenError('GitHub returned an empty OIDC token.')
  }

  source.setSecret(token)
  return token
}
