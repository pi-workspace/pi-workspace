import { useState, type ReactNode } from 'react'
import { ChevronDown, Folder, Layers3, Plus, Settings2 } from 'lucide-react'
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
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/ui-kit/sidebar'
import { Textarea } from '@/components/ui-kit/textarea'

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

  const closeDialog = () => {
    if (!saving) {
      setDialog(undefined)
      setError(undefined)
    }
  }

  const run = async (operation: () => Promise<void>) => {
    setSaving(true)
    setError(undefined)

    try {
      await operation()
      setDialog(undefined)
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
        <SidebarFooter className="shrink-0">
          <SidebarSection>
            <div className="flex items-center gap-1">
              <SidebarHeading className="mb-0 min-w-0 flex-1">Repositories</SidebarHeading>
              <button
                type="button"
                aria-label="Add Repositories"
                className="shrink-0 rounded-sm p-1.5 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                onClick={() => void run(() => onAddRepositories(selectedWorkspace.id))}
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div aria-label="Workspace Repositories" className="max-h-48 overflow-y-auto">
              {selectedWorkspace.repositories.map((repository) => (
                <div className="relative" key={repository.membershipId}>
                  <SidebarItem
                    className="[&>button]:pr-10"
                    onClick={() => openMembershipSettings(repository.membershipId)}
                  >
                    <Folder aria-hidden="true" className="size-4 shrink-0 text-sidebar-muted-foreground" />
                    <SidebarLabel>
                      {repository.name}
                      {repository.availability === 'unavailable' && ' (unavailable)'}
                    </SidebarLabel>
                  </SidebarItem>
                  <div className="absolute top-1/2 right-1 z-10 -translate-y-1/2">
                    <button
                      type="button"
                      aria-label={`${repository.name} settings`}
                      className="rounded-sm p-1.5 text-sidebar-muted-foreground hover:bg-sidebar-interaction hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      onClick={() => openMembershipSettings(repository.membershipId)}
                    >
                      <Settings2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {error && !dialog && (
              <p className="px-2 pt-2 text-xs/5 text-form-error-foreground" role="alert">
                {error}
              </p>
            )}
          </SidebarSection>
        </SidebarFooter>
      </Sidebar>

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

      <Dialog open={dialog?.type === 'workspace-settings'} onClose={closeDialog}>
        <DialogTitle>Workspace settings</DialogTitle>
        <DialogDescription>Change how this Workspace appears in Pi Workspace.</DialogDescription>
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
                void run(() => onRemoveRepository(selectedWorkspace.id, editingMembershipId))
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
              void run(() =>
                onUpdateMembership(selectedWorkspace.id, editingMembershipId, {
                  role,
                  relationships,
                  validationCommands: validationCommands.split('\n'),
                })
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
