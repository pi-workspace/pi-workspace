import { readFile } from 'node:fs/promises'
import { bundledReleaseNotes, validateReleaseNotes } from '../src/release-notes'
import { validateBetaReleaseVersion } from './release-version'
import { validateUpdateReleaseConfiguration } from './update-release-configuration'

const packageMetadata: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version =
  packageMetadata &&
  typeof packageMetadata === 'object' &&
  'version' in packageMetadata &&
  typeof packageMetadata.version === 'string'
    ? packageMetadata.version
    : ''
const issues = [
  ...validateReleaseNotes(bundledReleaseNotes, version),
  ...validateBetaReleaseVersion(version),
  ...validateUpdateReleaseConfiguration(packageMetadata),
]

if (issues.length > 0) {
  throw new Error(issues.join('\n'))
}

console.log(`Release contract valid for v${version}.`)
