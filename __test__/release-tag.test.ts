import { describe, expect, test } from '@jest/globals'
import { hasRemoteTag, releaseTag } from '../scripts/release-tag.js'

describe('releaseTag', () => {
  test('names a whole-number release by its major version', () => {
    expect(releaseTag('4.0.0')).toBe('v4')
    expect(releaseTag('12.0.0')).toBe('v12')
  })

  test.each(['4.1.0', '4.0.1', '4.0.0-rc.1', 'v4', ''])('refuses %p', version => {
    expect(() => releaseTag(version)).toThrow('not a whole-number release')
  })
})

describe('hasRemoteTag', () => {
  const lsRemote = 'abc\trefs/tags/v3\ndef\trefs/tags/v3^{}\nghi\trefs/tags/v30'

  test('finds a tag that origin already has', () => {
    expect(hasRemoteTag(lsRemote, 'v3')).toBe(true)
  })

  test('does not match a tag that only shares a prefix', () => {
    expect(hasRemoteTag(lsRemote, 'v4')).toBe(false)
    expect(hasRemoteTag('abc\trefs/tags/v30', 'v3')).toBe(false)
  })
})
