import { isAbsolute, relative, resolve, sep } from 'node:path'

export const applicationProtocolScheme = 'pi-workspace'
export const productionRendererUrl = `${applicationProtocolScheme}://renderer/index.html`

type RendererSource = Readonly<{
  isMainFrame: boolean
  sourceUrl: string
  trustedRendererUrl: string
}>

export function isTrustedRendererSource({ isMainFrame, sourceUrl, trustedRendererUrl }: RendererSource): boolean {
  return isMainFrame && isTrustedRendererUrl(sourceUrl, trustedRendererUrl)
}

export function isTrustedRendererUrl(candidateUrl: string, trustedRendererUrl: string): boolean {
  return candidateUrl === trustedRendererUrl
}

interface NavigationEvent {
  preventDefault(): void
}

export function preventUntrustedRendererNavigation(
  event: NavigationEvent,
  candidateUrl: string,
  trustedRendererUrl: string
): void {
  if (!isTrustedRendererUrl(candidateUrl, trustedRendererUrl)) event.preventDefault()
}

export function denyWindowOpen(): Readonly<{ action: 'deny' }> {
  return { action: 'deny' }
}

export function allowBrowserPermissionCheck(_webContents: unknown, permission: unknown): boolean {
  return permission === 'clipboard-sanitized-write'
}

export function allowBrowserPermissionRequest(
  _webContents: unknown,
  permission: unknown,
  callback: (permissionGranted: boolean) => void
): void {
  callback(permission === 'clipboard-sanitized-write')
}

export function resolveRendererAssetPath(requestUrl: string, rendererDirectory: string): string | undefined {
  let url: URL

  try {
    url = new URL(requestUrl)
  } catch {
    return undefined
  }

  if (url.protocol !== `${applicationProtocolScheme}:` || url.host !== 'renderer' || url.username || url.password) {
    return undefined
  }

  const rawPathStart = requestUrl.indexOf('/', `${applicationProtocolScheme}://`.length)
  const rawPath = rawPathStart === -1 ? '/' : requestUrl.slice(rawPathStart).split(/[?#]/, 1)[0]
  let pathname: string

  try {
    pathname = decodeURIComponent(rawPath)
  } catch {
    return undefined
  }

  if (pathname.includes('\\') || pathname.split('/').includes('..')) return undefined

  const assetPath = resolve(rendererDirectory, `.${pathname}`)
  const relativeAssetPath = relative(rendererDirectory, assetPath)

  if (relativeAssetPath === '..' || relativeAssetPath.startsWith(`..${sep}`) || isAbsolute(relativeAssetPath)) {
    return undefined
  }

  return assetPath
}

type RendererUrlOptions = Readonly<{
  isPackaged: boolean
  developmentServerUrl?: string
  productionRendererUrl: string
}>

export function resolveRendererUrl({
  isPackaged,
  developmentServerUrl,
  productionRendererUrl,
}: RendererUrlOptions): string {
  if (isPackaged || !developmentServerUrl) {
    return productionRendererUrl
  }

  try {
    const url = new URL(developmentServerUrl)
    const isLoopbackHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

    if (url.protocol === 'http:' && isLoopbackHost) {
      return url.href
    }
  } catch {
    // Report every malformed or unsupported development URL consistently.
  }

  throw new TypeError('The development renderer URL must use HTTP on a loopback host.')
}
