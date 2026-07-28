type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined
}

function hasUniversalTarget(targets: unknown, expectedTarget: string): boolean {
  return (
    Array.isArray(targets) &&
    targets.some((value) => {
      const target = record(value)

      return target?.target === expectedTarget && Array.isArray(target.arch) && target.arch.includes('universal')
    })
  )
}

export function validateUpdateReleaseConfiguration(packageMetadata: unknown): readonly string[] {
  const issues: string[] = []
  const metadata = record(packageMetadata)
  const scripts = record(metadata?.scripts)
  const build = record(metadata?.build)
  const publish = record(build?.publish)
  const mac = record(build?.mac)
  const macPublish = record(mac?.publish)

  if (
    publish?.provider !== 'github' ||
    publish.owner !== 'pi-workspace' ||
    publish.repo !== 'railyard' ||
    publish.releaseType !== 'prerelease' ||
    publish.channel !== 'beta' ||
    publish.publishAutoUpdate !== false ||
    macPublish?.provider !== 'github' ||
    macPublish.owner !== 'pi-workspace' ||
    macPublish.repo !== 'railyard' ||
    macPublish.releaseType !== 'prerelease' ||
    macPublish.channel !== 'beta' ||
    macPublish.publishAutoUpdate !== true
  ) {
    issues.push('The updater must publish beta prereleases from pi-workspace/railyard.')
  }

  if (scripts?.['package:mac'] !== 'bun run build && electron-builder --mac --universal --publish never') {
    issues.push('The macOS packaging command must build every configured release target.')
  }

  if (!hasUniversalTarget(mac?.target, 'dmg')) {
    issues.push('The macOS release requires a universal DMG.')
  }
  if (!hasUniversalTarget(mac?.target, 'zip')) {
    issues.push('The macOS release requires a universal ZIP updater payload.')
  }

  return issues
}
