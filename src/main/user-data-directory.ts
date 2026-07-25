import { createHash } from 'node:crypto'
import { join } from 'node:path'

const productionUserDataDirectoryName = 'Railyard'
const developmentUserDataDirectoryName = 'Railyard Development'

function developmentSpaceDirectoryName(developmentSpace: string): string {
  const readableName = developmentSpace
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const hash = createHash('sha256').update(developmentSpace).digest('hex').slice(0, 16)

  return `${readableName || 'development'}-${hash}`
}

export function resolveUserDataDirectory(applicationDataDirectory: string, developmentSpace?: string): string {
  if (!developmentSpace) return join(applicationDataDirectory, productionUserDataDirectoryName)

  return join(
    applicationDataDirectory,
    developmentUserDataDirectoryName,
    developmentSpaceDirectoryName(developmentSpace)
  )
}
