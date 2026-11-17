import * as core from '@actions/core'

export class InputError extends Error {}

export interface ImageReference {
  repository: string
  host: string
  digest: string
  reference: string
}

// A workflow names its environment by the target the Apervia console shows,
// which never changes. A workflow written before targets existed names the
// application and environment slugs, and stops deploying when somebody changes
// the application's address.
export type Destination = { target: string } | { application: string; environment: string }

export interface Inputs {
  destination: Destination
  image: ImageReference
  platformUrl: URL
  pollIntervalMs: number
  timeoutMs: number
  autoDeploy: boolean
}

const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const TARGET = /^env_[a-z2-7]{20}$/
const DIGEST = /^sha256:[a-f0-9]{64}$/

// The longest slugs the platform creates, so a slug that exists always passes.
const SLUG_BUDGET = { application: 24, environment: 13 }

const POLL_INTERVAL_BOUNDS = { min: 1, max: 60 }
const TIMEOUT_BOUNDS = { min: 30, max: 3600 }

export function readInputs(): Inputs {
  return {
    destination: parseDestination(
      core.getInput('target'),
      core.getInput('application'),
      core.getInput('environment')
    ),
    image: parseImage(core.getInput('image')),
    platformUrl: parsePlatformUrl(core.getInput('platform-url')),
    pollIntervalMs: parseSeconds(
      'poll-interval',
      core.getInput('poll-interval'),
      POLL_INTERVAL_BOUNDS
    ),
    timeoutMs: parseSeconds('timeout', core.getInput('timeout'), TIMEOUT_BOUNDS),
    autoDeploy: parseBoolean('auto-deploy', core.getInput('auto-deploy'))
  }
}

export function parseBoolean(name: string, raw: string): boolean {
  switch (raw.trim()) {
    case 'true':
      return true
    case 'false':
      return false
    default:
      throw new InputError(`The input "${name}" must be true or false.`)
  }
}

export function parseDestination(
  rawTarget: string,
  rawApplication: string,
  rawEnvironment: string
): Destination {
  const target = rawTarget.trim()
  const named = rawApplication.trim() !== '' || rawEnvironment.trim() !== ''
  if (target === '' && !named) {
    throw new InputError(
      'The input "target" is required. Copy the workflow from the environment in the Apervia console.'
    )
  }
  if (target !== '' && named) {
    throw new InputError(
      'Give the input "target", or the inputs "application" and "environment", not both.'
    )
  }
  if (target === '') {
    return {
      application: parseSlug('application', rawApplication, SLUG_BUDGET.application),
      environment: parseSlug('environment', rawEnvironment, SLUG_BUDGET.environment)
    }
  }
  if (!TARGET.test(target)) {
    throw new InputError(
      'The input "target" is not valid. Copy it from the workflow in the Apervia console.'
    )
  }
  return { target }
}

export function describeDestination(destination: Destination): string {
  return 'target' in destination
    ? destination.target
    : `${destination.application}/${destination.environment}`
}

export function parseSlug(name: string, raw: string, maxLength: number): string {
  const value = raw.trim()
  if (value === '') {
    throw new InputError(`The input "${name}" is required.`)
  }
  if (value.length > maxLength) {
    throw new InputError(`The input "${name}" must be ${maxLength} characters or fewer.`)
  }
  if (!SLUG.test(value)) {
    throw new InputError(
      `The input "${name}" must contain lowercase letters, digits and hyphens, and must start and end with a letter or a digit.`
    )
  }
  return value
}

export function parseImage(raw: string): ImageReference {
  const value = raw.trim()
  if (value === '') {
    throw new InputError('The input "image" is required.')
  }

  const separator = value.lastIndexOf('@')
  if (separator === -1) {
    throw new InputError(
      'The input "image" must name an exact digest, for example ghcr.io/acme/widget@sha256:<64 hex characters>. A tag is refused because a tag can move.'
    )
  }

  const repository = value.slice(0, separator)
  const digest = value.slice(separator + 1)

  if (!DIGEST.test(digest)) {
    throw new InputError(
      `The digest "${digest}" is not valid. It must be sha256: followed by 64 lowercase hexadecimal characters.`
    )
  }

  const host = repository.split('/')[0] ?? ''
  if (!isHost(host)) {
    throw new InputError(
      `The image "${repository}" does not name a registry host. Give the full repository, for example ghcr.io/acme/widget.`
    )
  }

  const path = repository.slice(host.length + 1)
  if (path === '') {
    throw new InputError(`The image "${repository}" does not name a repository path.`)
  }
  if (path.includes(':')) {
    throw new InputError(
      `The image "${repository}" carries a tag. Give the repository and the digest only, because a tag can move after you write it.`
    )
  }

  return { repository, host, digest, reference: `${repository}@${digest}` }
}

function isHost(candidate: string): boolean {
  if (candidate === '') {
    return false
  }
  return candidate.includes('.') || candidate.includes(':') || candidate === 'localhost'
}

export function parsePlatformUrl(raw: string): URL {
  const value = raw.trim()
  if (value === '') {
    throw new InputError('The input "platform-url" is required.')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InputError(`The input "platform-url" is not a valid URL: "${value}".`)
  }

  if (url.protocol !== 'https:') {
    throw new InputError('The input "platform-url" must use https.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new InputError('The input "platform-url" must not contain credentials.')
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new InputError(
      'The input "platform-url" must be an origin, with no path, query string or fragment.'
    )
  }

  return url
}

export function parseSeconds(
  name: string,
  raw: string,
  bounds: { min: number; max: number }
): number {
  const value = Number(raw.trim())
  if (!Number.isInteger(value)) {
    throw new InputError(`The input "${name}" must be a whole number of seconds.`)
  }
  if (value < bounds.min || value > bounds.max) {
    throw new InputError(
      `The input "${name}" must be between ${bounds.min} and ${bounds.max} seconds.`
    )
  }
  return value * 1000
}
