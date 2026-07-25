import { useState } from 'react'
import { Button } from '@/components/ui-kit/button'
import { Input } from '@/components/ui-kit/input'

type WorkspaceOnboardingScreenProperties = Readonly<{
  onCreateWorkspace(name: string): Promise<void>
}>

export function WorkspaceOnboardingScreen({ onCreateWorkspace }: WorkspaceOnboardingScreenProperties) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)

  async function createWorkspace(): Promise<void> {
    const workspaceName = name.trim()

    if (creating || !workspaceName) return
    setCreating(true)
    setError(undefined)

    try {
      await onCreateWorkspace(workspaceName)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the Workspace.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-content-background px-6 py-12">
      <section className="w-full max-w-md text-center">
        <img alt="Railyard" className="mx-auto size-20 dark:hidden" src="./railyard-symbol-light.svg" />
        <img alt="" className="mx-auto hidden size-20 dark:block" src="./railyard-symbol-dark.svg" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-content-foreground">
          Create your first Workspace
        </h1>
        <p className="mt-4 text-base/7 text-content-muted-foreground">
          Name your Workspace, then select at least one local Git Repository.
        </p>
        <form
          className="mx-auto mt-8 flex w-full max-w-sm flex-col gap-4 text-left"
          onSubmit={(event) => {
            event.preventDefault()
            void createWorkspace()
          }}
        >
          <label className="text-sm font-medium text-content-foreground" htmlFor="workspace-name">
            Workspace name
          </label>
          <Input id="workspace-name" onChange={(event) => setName(event.target.value)} required value={name} />
          {error && (
            <p className="text-sm text-form-error-foreground" role="alert">
              {error}
            </p>
          )}
          <Button className="w-full" disabled={creating || !name.trim()} type="submit">
            {creating ? 'Creating…' : 'Select Repository and create Workspace'}
          </Button>
        </form>
      </section>
    </main>
  )
}
