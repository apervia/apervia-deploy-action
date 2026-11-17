const WHOLE_NUMBER_RELEASE = /^(\d+)\.0\.0$/

export function releaseTag(packageVersion: string): string {
  const major = WHOLE_NUMBER_RELEASE.exec(packageVersion)?.[1]
  if (major === undefined) {
    throw new Error(
      `package.json version ${packageVersion} is not a whole-number release such as 4.0.0`
    )
  }
  return `v${major}`
}

export function hasRemoteTag(lsRemote: string, tag: string): boolean {
  return lsRemote
    .split('\n')
    .some(line => line.endsWith(`refs/tags/${tag}`) || line.endsWith(`refs/tags/${tag}^{}`))
}
