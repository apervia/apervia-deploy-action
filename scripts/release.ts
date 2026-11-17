import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { hasRemoteTag, releaseTag } from './release-tag.ts'

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function requireCleanMainInSyncWithOrigin(): void {
  if (git('status', '--porcelain') !== '') {
    throw new Error('The working tree is dirty. Commit or stash before releasing.')
  }
  const branch = git('branch', '--show-current')
  if (branch !== 'main') {
    throw new Error(`Release from main, not ${branch}.`)
  }
  execFileSync('git', ['fetch', 'origin', '--tags'], { stdio: 'inherit' })
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    throw new Error('main is not in sync with origin/main. Pull or push first.')
  }
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(`${question} [y/N] `)
  prompt.close()
  return answer.trim().toLowerCase() === 'y'
}

async function release(): Promise<void> {
  requireCleanMainInSyncWithOrigin()

  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
  const tag = releaseTag(version)
  if (hasRemoteTag(git('ls-remote', '--tags', 'origin'), tag)) {
    throw new Error(
      `${tag} is already released. Bump the version in package.json and src/version.ts first.`
    )
  }

  if (!(await confirm(`Publish ${tag} from ${git('rev-parse', '--short', 'HEAD')}?`))) {
    throw new Error('Cancelled.')
  }

  execFileSync(
    'gh',
    ['release', 'create', tag, '--target', 'main', '--title', tag, '--generate-notes'],
    { stdio: 'inherit' }
  )
}

release().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
