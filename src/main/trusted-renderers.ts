export type ManagedRendererFrame = Readonly<{
  url: string
}>

export type ManagedRendererWebContents = Readonly<{
  mainFrame: ManagedRendererFrame
  send(channel: string, ...arguments_: unknown[]): void
}>

export type ManagedRendererWindow = Readonly<{
  webContents: ManagedRendererWebContents
}>

type RendererInvokeEvent = Readonly<{
  sender: ManagedRendererWebContents
  senderFrame: ManagedRendererFrame | null
}>

export interface TrustedRendererAuthority {
  register(window: ManagedRendererWindow): () => void
  isAuthorized(event: RendererInvokeEvent): boolean
  broadcast(channel: string, ...arguments_: unknown[]): void
}

export function createTrustedRendererAuthority(trustedRendererUrl: string): TrustedRendererAuthority {
  const windows = new Set<ManagedRendererWindow>()

  return {
    register(window) {
      windows.add(window)

      return () => windows.delete(window)
    },
    isAuthorized(event) {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
      if (event.senderFrame.url !== trustedRendererUrl) return false

      return [...windows].some((window) => window.webContents === event.sender)
    },
    broadcast(channel, ...arguments_) {
      windows.forEach((window) => window.webContents.send(channel, ...arguments_))
    },
  }
}
