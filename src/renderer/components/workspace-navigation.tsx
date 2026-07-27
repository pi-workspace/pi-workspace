import { useState, type ReactNode } from 'react'
import { ChevronDown, Folder, Layers3, Plus, Settings, Settings2 } from 'lucide-react'
import type { WorkspaceMembershipUpdate, WorkspacesSnapshot } from '@/src/application-state'
import { Button } from '@/components/ui-kit/button'
import { Checkbox, CheckboxField, CheckboxGroup } from '@/components/ui-kit/checkbox'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui-kit/dialog'
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from '@/components/ui-kit/dropdown'
import { Description, Field, FieldGroup, Fieldset, Label } from '@/components/ui-kit/fieldset'
import { Input } from '@/components/ui-kit/input'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
} from '@/components/ui-kit/sidebar'
import { Textarea } from '@/components/ui-kit/textarea'
import { SettingsDialog } from '@/src/renderer/components/settings-dialog'

type WorkspaceNavigationProperties = Readonly<{
  children: ReactNode
  workspaces: WorkspacesSnapshot['workspaces']
  selectedWorkspaceId: string | undefined
  onSelectWorkspace(workspaceId: string): void
  onCreateWorkspace(name: string): Promise<void>
  onRenameWorkspace(workspaceId: string, name: string): Promise<void>
  onAddRepositories(workspaceId: string): Promise<void>
  onRemoveRepository(workspaceId: string, membershipId: string): Promise<void>
  onUpdateMembership(workspaceId: string, membershipId: string, update: WorkspaceMembershipUpdate): Promise<void>
  applicationVersion?: string
  onOpenChangelog?(): void
}>

type DialogState =
  | Readonly<{ type: 'create-workspace' }>
  | Readonly<{ type: 'workspace-settings' }>
  | Readonly<{ type: 'membership-settings' }>
  | undefined

type WorkspaceDialogErrorProperties = Readonly<{
  message: string | undefined
}>

function WorkspaceDialogError({ message }: WorkspaceDialogErrorProperties) {
  return message ? (
    <p className="mt-4 text-sm text-form-error-foreground" role="alert">
      {message}
    </p>
  ) : null
}

export function WorkspaceNavigation({
  children,
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onAddRepositories,
  onRemoveRepository,
  onUpdateMembership,
  applicationVersion = 'Unknown',
  onOpenChangelog = () => {},
}: WorkspaceNavigationProperties) {
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0]
  const [dialog, setDialog] = useState<DialogState>()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [relationships, setRelationships] = useState<readonly string[]>([])
  const [validationCommands, setValidationCommands] = useState('')
  const [editingMembershipId, setEditingMembershipId] = useState<string>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const closeDialog = () => {
    if (saving) return

    setDialog(dialog?.type === 'membership-settings' ? { type: 'workspace-settings' } : undefined)
    setError(undefined)
  }

  const run = async (operation: () => Promise<void>, onSuccess: () => void = () => setDialog(undefined)) => {
    setSaving(true)
    setError(undefined)

    try {
      await operation()
      onSuccess()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not update the Workspace.')
    } finally {
      setSaving(false)
    }
  }

  const openCreateWorkspace = () => {
    setName('')
    setError(undefined)
    setDialog({ type: 'create-workspace' })
  }

  const openWorkspaceSettings = () => {
    if (!selectedWorkspace) return

    setName(selectedWorkspace.name)
    setError(undefined)
    setDialog({ type: 'workspace-settings' })
  }

  const openMembershipSettings = (membershipId: string) => {
    const membership = selectedWorkspace?.repositories.find((repository) => repository.membershipId === membershipId)
    if (!membership) return

    setRole(membership.role)
    setRelationships(membership.relationships)
    setValidationCommands(membership.validationCommands.join('\n'))
    setEditingMembershipId(membershipId)
    setError(undefined)
    setDialog({ type: 'membership-settings' })
  }

  const toggleRelationship = (membershipId: string, checked: boolean) => {
    setRelationships((current) =>
      checked ? [...current, membershipId] : current.filter((relationship) => relationship !== membershipId)
    )
  }

  if (!selectedWorkspace) return null

  return (
    <>
      <Sidebar>
        <SidebarHeader className="h-18 shrink-0 justify-center">
          <div className="flex items-center gap-1">
            <Dropdown>
              <DropdownButton as={SidebarItem} aria-label="Switch Workspace" className="min-w-0 flex-1">
                <Layers3 aria-hidden="true" className="size-5 shrink-0 text-sidebar-muted-foreground" />
                <SidebarLabel>{selectedWorkspace.name}</SidebarLabel>
                <ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-sidebar-muted-foreground" />
              </DropdownButton>
              <DropdownMenu anchor="bottom start" className="min-w-64">
                <DropdownItem onClick={openWorkspaceSettings}>
                  <Settings2 aria-hidden="true" data-slot="icon" />
                  <DropdownLabel>Workspace settings</DropdownLabel>
                </DropdownItem>
                <DropdownDivider />
                {workspaces.map((workspace) => (
                  <DropdownItem
                    aria-current={workspace.id === selectedWorkspace.id ? 'true' : undefined}
                    key={workspace.id}
                    onClick={() => onSelectWorkspace(workspace.id)}
                  >
                    <Layers3 aria-hidden="true" data-slot="icon" />
                    <DropdownLabel>{workspace.name}</DropdownLabel>
                    {workspace.id === selectedWorkspace.id && (
                      <span className="col-start-5 row-start-1 text-xs text-content-muted-foreground group-data-focus:text-dropdown-focus-foreground">
                        Current
                      </span>
                    )}
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
            <button
              type="button"
              aria-label="New Workspace"
              className="shrink-0 rounded-lg p-2 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              onClick={openCreateWorkspace}
            >
              <Plus aria-hidden="true" className="size-5" />
            </button>
          </div>
        </SidebarHeader>

        <SidebarBody>{children}</SidebarBody>
        <SidebarFooter className="shrink-0 border-t-0!">
          <div className="flex items-center justify-between gap-3">
            <Button
              plain
              aria-label="Settings"
              className="size-9! shrink-0 items-center! p-0! text-sidebar-foreground [--btn-icon:var(--theme-sidebar-muted-foreground)] data-hover:bg-sidebar-interaction data-hover:[--btn-icon:var(--theme-sidebar-foreground)]"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings aria-hidden="true" data-slot="icon" />
            </Button>
            <Button
              plain
              aria-label={`Release notes for version ${applicationVersion}`}
              className="min-w-0 px-2! py-1.5! font-mono text-xs/5! font-medium! text-sidebar-muted-foreground data-hover:bg-sidebar-interaction data-hover:text-sidebar-foreground"
              onClick={onOpenChangelog}
            >
              <span className="truncate">v{applicationVersion}</span>
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {settingsOpen && <SettingsDialog open onClose={() => setSettingsOpen(false)} />}

      <Dialog open={dialog?.type === 'create-workspace'} onClose={closeDialog}>
        <DialogTitle>Create Workspace</DialogTitle>
        <DialogDescription>Name the Workspace, then choose at least one local Git Repository.</DialogDescription>
        <DialogBody>
          <Fieldset>
            <Field>
              <Label>Workspace name</Label>
              <Input autoFocus onChange={(event) => setName(event.target.value)} value={name} />
            </Field>
          </Fieldset>
          <WorkspaceDialogError message={error} />
        </DialogBody>
        <DialogActions>
          <Button plain onClick={closeDialog}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void run(() => onCreateWorkspace(name))}>
            Select Repositories
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog?.type === 'workspace-settings'} onClose={closeDialog} size="xl">
        <DialogTitle>Workspace settings</DialogTitle>
        <DialogDescription>Change how this Workspace appears in Railyard.</DialogDescription>
        <DialogBody>
          <Fieldset>
            <FieldGroup>
              <Field>
                <Label>Workspace name</Label>
                <Input autoFocus onChange={(event) => setName(event.target.value)} value={name} />
              </Field>
              <Field>
                <div className="flex items-center gap-3">
                  <Label className="flex-1">Repositories</Label>
                  <Button
                    plain
                    className="-my-1"
                    disabled={saving}
                    onClick={() =>
                      void run(
                        () => onAddRepositories(selectedWorkspace.id),
                        () => {}
                      )
                    }
                  >
                    <Plus aria-hidden="true" data-slot="icon" />
                    Add Repositories
                  </Button>
                </div>
                <Description>Manage the local Git Repositories available to this Workspace.</Description>
                <div
                  aria-label="Workspace Repositories"
                  className="mt-4 divide-y divide-content-border overflow-hidden rounded-lg border border-content-border"
                >
                  {selectedWorkspace.repositories.map((repository) => (
                    <button
                      type="button"
                      aria-label={`${repository.name} settings`}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-content-interaction focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
                      key={repository.membershipId}
                      onClick={() => openMembershipSettings(repository.membershipId)}
                    >
                      <Folder aria-hidden="true" className="size-4 shrink-0 text-content-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm/5 font-medium text-content-foreground">
                          {repository.name}
                        </span>
                        <span className="block truncate text-xs/5 text-content-muted-foreground">
                          {repository.availability === 'unavailable' ? 'Unavailable' : repository.directoryPath}
                        </span>
                      </span>
                      <Settings2 aria-hidden="true" className="size-4 shrink-0 text-content-muted-foreground" />
                    </button>
                  ))}
                </div>
              </Field>
            </FieldGroup>
          </Fieldset>
          <WorkspaceDialogError message={error} />
        </DialogBody>
        <DialogActions>
          <Button plain onClick={closeDialog}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void run(() => onRenameWorkspace(selectedWorkspace.id, name))}>
            Save changes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog?.type === 'membership-settings'} onClose={closeDialog}>
        <DialogTitle>Repository settings</DialogTitle>
        <DialogBody>
          <Fieldset>
            <FieldGroup>
              <Field>
                <Label>Role in this Workspace</Label>
                <Description>What this Repository contributes, such as desktop app, API, or documentation.</Description>
                <Input onChange={(event) => setRole(event.target.value)} value={role} />
              </Field>
              {selectedWorkspace.repositories.length > 1 && (
                <Field>
                  <Label>Related Repositories</Label>
                  <CheckboxGroup>
                    {selectedWorkspace.repositories
                      .filter((repository) => repository.membershipId !== editingMembershipId)
                      .map((repository) => (
                        <CheckboxField key={repository.membershipId}>
                          <Checkbox
                            checked={relationships.includes(repository.membershipId)}
                            onChange={(checked) => toggleRelationship(repository.membershipId, checked)}
                          />
                          <Label>{repository.name}</Label>
                        </CheckboxField>
                      ))}
                  </CheckboxGroup>
                </Field>
              )}
              <Field>
                <Label>Default validation commands</Label>
                <Textarea
                  onChange={(event) => setValidationCommands(event.target.value)}
                  placeholder="One command per line"
                  rows={4}
                  value={validationCommands}
                />
              </Field>
            </FieldGroup>
          </Fieldset>
          <WorkspaceDialogError message={error} />
        </DialogBody>
        <DialogActions>
          {selectedWorkspace.repositories.length > 1 && (
            <Button
              className="sm:mr-auto"
              plain
              disabled={saving}
              onClick={() => {
                if (!editingMembershipId) return
                void run(() => onRemoveRepository(selectedWorkspace.id, editingMembershipId), openWorkspaceSettings)
              }}
            >
              Remove Repository
            </Button>
          )}
          <Button plain onClick={closeDialog}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              if (!editingMembershipId) return
              void run(
                () =>
                  onUpdateMembership(selectedWorkspace.id, editingMembershipId, {
                    role,
                    relationships,
                    validationCommands: validationCommands.split('\n'),
                  }),
                openWorkspaceSettings
              )
            }}
          >
            Save changes
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
