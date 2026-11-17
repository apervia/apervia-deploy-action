import { readFileSync } from 'node:fs'
import { describe, expect, test } from '@jest/globals'
import { VERSION } from '../src/version.js'

describe('VERSION', () => {
  test('matches package.json, because the platform records it as telemetry', () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as {
      version: string
    }
    expect(VERSION).toBe(pkg.version)
  })
})
