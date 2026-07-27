import { useEffect, useRef, useState } from 'react'
import { FolderGit2, FolderOpen, GitBranch, LoaderCircle } from 'lucide-react'
import { Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu } from '@/components/ui-kit/dropdown'
import type { SessionId } from '@/src/domain/session'
import type {
  SessionRepositoryWorkingLocation,
  SessionWorkingLocationsBridge,
  SessionWorkingLocationsSnapshot,
} from '@/src/session-working-locations'

type SessionWorkingLocationControlsProperties = Readonly<{
  bridge: SessionWorkingLocationsBridge
  canCreateWorktree: boolean
  isWorking: boolean
  sessionId: SessionId
}>

export function SessionWorkingLocationControls({
  bridge,
  canCreateWorktree,
  isWorking,
  sessionId,
}: SessionWorkingLocationControlsProperties) {
  const request = useRef(0)
  const [snapshot, setSnapshot] = useState<SessionWorkingLocationsSnapshot>()
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const currentRequest = ++request.current
    setSnapshot(undefined)
    setSelectedRepositoryId(undefined)
    setError(undefined)

    void bridge.get(sessionId).then(
      (nextSnapshot) => {
        if (request.current !== currentRequest) return
        setSnapshot(nextSnapshot)
        setSelectedRepositoryId(nextSnapshot.repositories[0]?.repositoryId)
      },
      () => {
        if (request.current === currentRequest) setError('Repository context is unavailable.')
      }
    )
  }, [bridge, isWorking, sessionId])

  const repositories = snapshot?.repositories ?? []
  const selectedRepository =
    repositories.find((repository) => repository.repositoryId === selectedRepositoryId) ?? repositories[0]

  const createWorktree = async () => {
    if (!selectedRepository || creating || isWorking) return

    setCreating(true)
    setError(undefined)
    try {
      const nextSnapshot = await bridge.createWorktree(sessionId, selectedRepository.repositoryId)
      setSnapshot(nextSnapshot)
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not create the Session worktree.')
    } finally {
      setCreating(false)
    }
  }

  if (repositories.length === 0 && !error) return null

  return (
    <div className="px-1.5 pt-1.5" aria-label="Session working context">
      {selectedRepository && (
        <div className="flex min-w-0 items-center justify-between gap-3 text-xs/5 text-composer-muted-foreground">
          {repositories.length === 1 ? (
            <span className="flex min-w-0 items-center gap-1.5 px-2 py-1">
              <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{selectedRepository.repositoryName}</span>
            </span>
          ) : (
            <Dropdown>
              <DropdownButton
                as="button"
                aria-label="Repository"
                className="flex max-w-[45%] min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-composer-muted-foreground hover:bg-composer-interaction hover:text-content-foreground"
              >
                <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{selectedRepository.repositoryName}</span>
              </DropdownButton>
              <DropdownMenu anchor="top start">
                {repositories.map((repository) => (
                  <DropdownItem
                    key={repository.repositoryId}
                    onClick={() => setSelectedRepositoryId(repository.repositoryId)}
                  >
                    <FolderGit2 aria-hidden="true" data-slot="icon" />
                    <DropdownLabel>{repository.repositoryName}</DropdownLabel>
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
          )}
          <WorkingLocationControl
            canCreateWorktree={canCreateWorktree}
            creating={creating}
            isWorking={isWorking}
            location={selectedRepository}
            onCreateWorktree={() => void createWorktree()}
          />
        </div>
      )}
      {error && (
        <p className="px-2 pt-1 text-xs/5 text-composer-error-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function WorkingLocationControl({
  canCreateWorktree,
  creating,
  isWorking,
  location,
  onCreateWorktree,
}: Readonly<{
  canCreateWorktree: boolean
  creating: boolean
  isWorking: boolean
  location: SessionRepositoryWorkingLocation
  onCreateWorktree: () => void
}>) {
  if (location.kind === 'worktree' && location.availability === 'available' && !creating) {
    return (
      <button
        type="button"
        aria-label="Copy worktree path"
        className="flex min-w-0 max-w-[55%] items-center gap-1.5 rounded-md px-2 py-1 text-composer-muted-foreground hover:bg-composer-interaction hover:text-content-foreground"
        title={relativeWorktreePath(location.workingPath)}
        onClick={(event) => {
          event.stopPropagation()
          void window.navigator.clipboard.writeText(location.workingPath).catch(() => {})
        }}
      >
        <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">Worktree</span>
      </button>
    )
  }

  const label = workingLocationLabel(location)
  const content = (
    <span className="flex min-w-0 items-center gap-1.5">
      {creating ? (
        <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : (
        <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{creating ? 'Creating worktree…' : label}</span>
    </span>
  )

  if (!canCreateWorktree || location.availability === 'unavailable') {
    return (
      <span className="min-w-0 px-2 py-1" title={label}>
        {content}
      </span>
    )
  }

  return (
    <Dropdown>
      <DropdownButton
        as="button"
        aria-label={label}
        disabled={creating || isWorking}
        className="min-w-0 rounded-md px-2 py-1 text-composer-muted-foreground hover:bg-composer-interaction hover:text-content-foreground disabled:opacity-50"
      >
        {content}
      </DropdownButton>
      <DropdownMenu anchor="top end">
        <DropdownItem disabled={creating || isWorking} onClick={onCreateWorktree}>
          <GitBranch aria-hidden="true" data-slot="icon" />
          <DropdownLabel>Create worktree</DropdownLabel>
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  )
}

function relativeWorktreePath(workingPath: string): string {
  const pathSegments = workingPath.split(/[\\/]+/).filter(Boolean)
  const worktreesSegment = pathSegments.lastIndexOf('.worktrees')

  return pathSegments.slice(worktreesSegment < 0 ? -2 : worktreesSegment).join('/')
}

function workingLocationLabel(location: SessionRepositoryWorkingLocation): string {
  if (location.availability === 'unavailable') return 'Repository unavailable'

  return `Current checkout · ${location.branch}`
}
