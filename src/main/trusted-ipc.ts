import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { createTrustedRendererAuthority, type TrustedRendererAuthority } from '@/src/main/trusted-renderers'

let configuredRendererUrl: string | undefined
let rendererAuthority: TrustedRendererAuthority | undefined

export function configureTrustedRendererUrl(rendererUrl: string): void {
  if (configuredRendererUrl && configuredRendererUrl !== rendererUrl) {
    throw new Error('The trusted renderer URL is already configured.')
  }

  configuredRendererUrl = rendererUrl
  rendererAuthority ??= createTrustedRendererAuthority(rendererUrl)
}

export function registerTrustedRendererWindow(window: BrowserWindow): () => void {
  if (!rendererAuthority) throw new Error('The trusted renderer URL has not been configured.')

  return rendererAuthority.register(window)
}

export function broadcastToTrustedRenderers(channel: string, ...arguments_: unknown[]): void {
  rendererAuthority?.broadcast(channel, ...arguments_)
}

export function handleTrustedIpc<Arguments extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result
): void {
  ipcMain.handle(channel, (event, ...arguments_) => {
    if (!rendererAuthority?.isAuthorized(event)) {
      throw new Error('IPC request rejected from an untrusted renderer.')
    }

    return listener(event, ...(arguments_ as Arguments))
  })
}
