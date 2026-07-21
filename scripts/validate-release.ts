import { readFile } from 'node:fs/promises'
import { bundledReleaseNotes, validateReleaseNotes } from '../src/release-notes'
import { validateBetaReleaseVersion } from './release-version'

const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}
const issues = [
  ...validateReleaseNotes(bundledReleaseNotes, packageMetadata.version),
  ...validateBetaReleaseVersion(packageMetadata.version),
]

if (issues.length > 0) {
  throw new Error(issues.join('\n'))
}

console.log(`Release contract valid for v${packageMetadata.version}.`)
