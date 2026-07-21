export interface ApplicationWindow {
  isMinimized(): boolean
  restore(): void
  focus(): void
  onClosed(listener: () => void): void
}

export type ApplicationLifecycleOptions = Readonly<{
  platform: NodeJS.Platform
  requestSingleInstanceLock: () => boolean
  quit: () => void
  whenReady: () => Promise<void>
  onSecondInstance: (listener: () => void) => void
  onActivate: (listener: () => void) => void
  onWindowAllClosed: (listener: () => void) => void
  initializeApplication: () => Promise<void>
  createWindow: () => ApplicationWindow
}>

export function startApplicationLifecycle(options: ApplicationLifecycleOptions): boolean {
  if (!options.requestSingleInstanceLock()) {
    options.quit()

    return false
  }

  let window: ApplicationWindow | undefined
  const initialization = options.whenReady().then(options.initializeApplication)

  async function showWindow(): Promise<void> {
    await initialization

    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()

      return
    }

    const createdWindow = options.createWindow()
    window = createdWindow
    createdWindow.onClosed(() => {
      if (window === createdWindow) window = undefined
    })
  }

  options.onSecondInstance(() => {
    void showWindow()
  })
  options.onActivate(() => {
    void showWindow()
  })
  options.onWindowAllClosed(() => {
    if (options.platform !== 'darwin') options.quit()
  })

  void showWindow()

  return true
}
