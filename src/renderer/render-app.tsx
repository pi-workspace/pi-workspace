import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppProperties } from '@/src/renderer/app'
import { App } from '@/src/renderer/app'
import { ThemeProvider } from '@/src/renderer/theme'
import './style.css'

type RendererErrorBoundaryProperties = Readonly<{ children: ReactNode }>
type RendererErrorBoundaryState = Readonly<{ failed: boolean }>

export class RendererErrorBoundary extends Component<RendererErrorBoundaryProperties, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The renderer failed unexpectedly.', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <main className="flex min-h-full items-center justify-center bg-page-background px-8 py-12">
        <div className="max-w-md text-center" role="alert">
          <h1 className="text-lg/7 font-semibold text-content-foreground">Pi Workspace encountered a problem</h1>
          <p className="mt-2 text-sm/6 text-content-muted-foreground">
            Your saved Workspaces and Sessions are unaffected. Reload the window to continue.
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-composer-action-background px-3 py-2 text-sm font-medium text-composer-action-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={() => window.location.reload()}
          >
            Reload Pi Workspace
          </button>
        </div>
      </main>
    )
  }
}

export function renderApp(properties: AppProperties = {}): void {
  const element = document.querySelector<HTMLElement>('#app')

  if (!element) throw new Error('The application root was not found.')

  createRoot(element).render(
    <RendererErrorBoundary>
      <ThemeProvider>
        <App {...properties} />
      </ThemeProvider>
    </RendererErrorBoundary>
  )
}
