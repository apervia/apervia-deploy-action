import { describe, expect, test } from '@jest/globals'
import {
  InputError,
  parseBoolean,
  parseImage,
  parsePlatformUrl,
  parseDestination,
  parseSeconds,
  parseSlug
} from '../src/inputs.js'

const DIGEST = `sha256:${'a'.repeat(64)}`

describe('parseDestination', () => {
  const target = 'env_abcdefghijklmnopqrst'

  test('takes the target', () => {
    expect(parseDestination(`  ${target}  `, '', '')).toEqual({ target })
  })

  test('takes the slugs of a workflow written before targets', () => {
    expect(parseDestination('', 'my-app', 'production')).toEqual({
      application: 'my-app',
      environment: 'production'
    })
  })

  test.each([
    ['', '', '', 'nothing'],
    [target, 'my-app', 'production', 'a target and the slugs'],
    [target, 'my-app', '', 'a target and an application'],
    ['', 'my-app', '', 'an application alone'],
    ['my-app', '', '', 'a slug as the target'],
    ['env_ABCDEFGHIJKLMNOPQRST', '', '', 'an uppercase target'],
    [`${target}x`, '', '', 'a target that is too long']
  ])('refuses %s / %s / %s (%s)', (raw, application, environment) => {
    expect(() => parseDestination(raw, application, environment)).toThrow(InputError)
  })
})

describe('parseSlug', () => {
  test.each(['app', 'my-app', 'a', 'a1', 'a-1-b'])('accepts %s', value => {
    expect(parseSlug('application', value, 24)).toBe(value)
  })

  test.each([
    ['', 'empty'],
    ['  ', 'whitespace only'],
    ['My-App', 'uppercase'],
    ['-app', 'leading hyphen'],
    ['app-', 'trailing hyphen'],
    ['my_app', 'underscore'],
    ['my app', 'space'],
    ['my.app', 'dot']
  ])('refuses %s (%s)', value => {
    expect(() => parseSlug('application', value, 24)).toThrow(InputError)
  })

  test('accepts a slug at the budget', () => {
    expect(parseSlug('application', 'a'.repeat(24), 24)).toBe('a'.repeat(24))
  })

  test('refuses a slug over the budget', () => {
    expect(() => parseSlug('application', 'a'.repeat(25), 24)).toThrow(InputError)
  })

  test('applies the budget it is given', () => {
    expect(parseSlug('environment', 'a'.repeat(13), 13)).toBe('a'.repeat(13))
    expect(() => parseSlug('environment', 'a'.repeat(14), 13)).toThrow(InputError)
  })

  test('trims surrounding whitespace', () => {
    expect(parseSlug('application', '  my-app  ', 24)).toBe('my-app')
  })
})

describe('parseImage', () => {
  test('accepts a repository and a digest', () => {
    const image = parseImage(`ghcr.io/acme/widget@${DIGEST}`)
    expect(image.host).toBe('ghcr.io')
    expect(image.repository).toBe('ghcr.io/acme/widget')
    expect(image.digest).toBe(DIGEST)
    expect(image.reference).toBe(`ghcr.io/acme/widget@${DIGEST}`)
  })

  test('accepts a host with a port', () => {
    expect(parseImage(`registry:5000/acme/widget@${DIGEST}`).host).toBe('registry:5000')
  })

  test.each([
    ['', 'empty'],
    ['ghcr.io/acme/widget', 'no digest'],
    ['ghcr.io/acme/widget:v1', 'a tag'],
    [`ghcr.io/acme/widget:v1@${DIGEST}`, 'a tag and a digest'],
    [`widget@${DIGEST}`, 'no host'],
    [`ghcr.io@${DIGEST}`, 'no repository path'],
    [`ghcr.io/acme/widget@sha256:${'A'.repeat(64)}`, 'uppercase hex'],
    [`ghcr.io/acme/widget@sha256:${'a'.repeat(63)}`, 'short digest'],
    [`ghcr.io/acme/widget@sha256:${'a'.repeat(65)}`, 'long digest'],
    [`ghcr.io/acme/widget@sha512:${'a'.repeat(64)}`, 'another algorithm'],
    [`ghcr.io/acme/widget@${'a'.repeat(64)}`, 'no algorithm'],
    [`ghcr.io/acme/widget@sha256:${'g'.repeat(64)}`, 'non hexadecimal']
  ])('refuses %s (%s)', value => {
    expect(() => parseImage(value)).toThrow(InputError)
  })
})

describe('parsePlatformUrl', () => {
  test('accepts an https origin', () => {
    expect(parsePlatformUrl('https://admin.example.com').origin).toBe('https://admin.example.com')
  })

  test('accepts a trailing slash', () => {
    expect(parsePlatformUrl('https://admin.example.com/').origin).toBe('https://admin.example.com')
  })

  test.each([
    ['', 'empty'],
    ['admin.example.com', 'no scheme'],
    ['http://admin.example.com', 'http'],
    ['ftp://admin.example.com', 'another scheme'],
    ['https://user:pass@admin.example.com', 'credentials'],
    ['https://admin.example.com/api', 'a path'],
    ['https://admin.example.com/?a=b', 'a query string'],
    ['https://admin.example.com/#a', 'a fragment']
  ])('refuses %s (%s)', value => {
    expect(() => parsePlatformUrl(value)).toThrow(InputError)
  })
})

describe('parseSeconds', () => {
  const bounds = { min: 1, max: 60 }

  test('returns milliseconds', () => {
    expect(parseSeconds('poll-interval', '5', bounds)).toBe(5000)
  })

  test.each([
    ['0', 'below the minimum'],
    ['61', 'above the maximum'],
    ['-1', 'negative'],
    ['1.5', 'fractional'],
    ['', 'empty'],
    ['five', 'not a number'],
    ['Infinity', 'not finite']
  ])('refuses %s (%s)', value => {
    expect(() => parseSeconds('poll-interval', value, bounds)).toThrow(InputError)
  })
})

describe('parseBoolean', () => {
  test('reads true and false', () => {
    expect(parseBoolean('auto-deploy', 'true')).toBe(true)
    expect(parseBoolean('auto-deploy', ' false ')).toBe(false)
  })

  test.each(['', 'yes', 'False', '0'])('refuses %p', value => {
    expect(() => parseBoolean('auto-deploy', value)).toThrow(InputError)
  })
})
