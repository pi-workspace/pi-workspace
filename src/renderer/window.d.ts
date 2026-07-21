import type { PiWorkspaceBridge } from '@/src/pi-workspace'

declare global {
  interface Window {
    piWorkspace: PiWorkspaceBridge
  }
}

export {}
