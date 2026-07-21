import { isSemanticVersion } from '../src/release-notes'

export function validateBetaReleaseVersion(version: string): readonly string[] {
  const issues: string[] = []

  if (!isSemanticVersion(version)) {
    issues.push('The application version must be a semantic version.')
  } else if (!/-beta\.(?:0|[1-9]\d*)(?:\+|$)/.test(version)) {
    issues.push('The beta application version must use a numbered beta prerelease such as 0.1.0-beta.1.')
  }

  return issues
}
