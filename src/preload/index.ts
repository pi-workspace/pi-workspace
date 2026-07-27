import { contextBridge, ipcRenderer } from 'electron'
import type { ApplicationStateBridge, CreateWorkspaceOutcome } from '@/src/application-state-ipc'
import type { WorkspaceMembershipUpdate, WorkspacesSnapshot } from '@/src/application-state'
import { applicationStateIpcChannels } from '@/src/application-state-ipc'
import type { ComposerBridge, SessionMessageSubmissionResult, SessionRunStopResult } from '@/src/composer'
import type { PiWorkspaceBridge } from '@/src/pi-workspace'
import { composerIpcChannels } from '@/src/composer-ipc'
import type { WorkstreamsSnapshot } from '@/src/domain/workstream'
import type { SessionSkillsBridge } from '@/src/session-skills'
import { sessionSkillsIpcChannels } from '@/src/session-skills-ipc'
import type { SessionChangesBridge, SessionChangesSnapshot, SessionFileDiff } from '@/src/session-changes'
import { sessionChangesIpcChannels } from '@/src/session-changes-ipc'
import type { SessionFilesBridge } from '@/src/session-files'
import { sessionFilesIpcChannels } from '@/src/session-files-ipc'
import type {
  SessionConfigurationBridge,
  SessionConfigurationCommandResult,
  SessionConfigurationMutation,
  SessionConfigurationSnapshot,
} from '@/src/session-configuration'
import { sessionConfigurationIpcChannels } from '@/src/session-configuration-ipc'
import type { SettingsBridge, SettingsSnapshot, SettingsUpdate } from '@/src/settings'
import type { SessionForkOutcome, WorkstreamsBridge, WorkstreamCreationOutcome } from '@/src/workstreams'
import { workstreamsIpcChannels } from '@/src/workstreams-ipc'
import type { WorkstreamKnowledgeBridge } from '@/src/workstream-knowledge-ipc'
import type { WorkstreamKnowledge } from '@/src/domain/workstream-knowledge-transitions'
import { workstreamKnowledgeIpcChannels } from '@/src/workstream-knowledge-ipc'
import { settingsIpcChannels } from '@/src/settings-ipc'
import type { AgentActivityDetails, SessionWorkingStateSnapshot } from '@/src/session-timeline'
import type {
  SessionTranscriptBridge,
  SessionTranscriptMutation,
  SessionTranscriptSnapshot,
} from '@/src/session-transcript'
import { sessionTranscriptIpcChannels } from '@/src/session-transcript-ipc'

const settingsBridge: SettingsBridge = {
  getSnapshot() {
    return ipcRenderer.invoke(settingsIpcChannels.getSnapshot) as Promise<SettingsSnapshot>
  },
  update(update: SettingsUpdate) {
    return ipcRenderer.invoke(settingsIpcChannels.update, update) as Promise<SettingsSnapshot>
  },
  subscribe(listener) {
    const handleChange = (_event: Electron.IpcRendererEvent, snapshot: SettingsSnapshot) => {
      listener(snapshot)
    }

    ipcRenderer.on(settingsIpcChannels.changed, handleChange)

    return () => {
      ipcRenderer.removeListener(settingsIpcChannels.changed, handleChange)
    }
  },
}

const applicationStateBridge: ApplicationStateBridge = {
  getStartup() {
    return ipcRenderer.invoke(applicationStateIpcChannels.getStartup)
  },
  createBackup() {
    return ipcRenderer.invoke(applicationStateIpcChannels.createBackup)
  },
  reset(confirmation) {
    return ipcRenderer.invoke(applicationStateIpcChannels.reset, confirmation)
  },
  getWorkspaces() {
    return ipcRenderer.invoke(applicationStateIpcChannels.getWorkspaces)
  },
  createWorkspace(name) {
    return ipcRenderer.invoke(applicationStateIpcChannels.createWorkspace, name) as Promise<CreateWorkspaceOutcome>
  },
  renameWorkspace(workspaceId, name) {
    return ipcRenderer.invoke(
      applicationStateIpcChannels.renameWorkspace,
      workspaceId,
      name
    ) as Promise<WorkspacesSnapshot>
  },
  addWorkspaceRepositories(workspaceId) {
    return ipcRenderer.invoke(
      applicationStateIpcChannels.addWorkspaceRepositories,
      workspaceId
    ) as Promise<CreateWorkspaceOutcome>
  },
  removeWorkspaceRepository(workspaceId, membershipId) {
    return ipcRenderer.invoke(
      applicationStateIpcChannels.removeWorkspaceRepository,
      workspaceId,
      membershipId
    ) as Promise<WorkspacesSnapshot>
  },
  updateWorkspaceMembership(workspaceId, membershipId, update: WorkspaceMembershipUpdate) {
    return ipcRenderer.invoke(
      applicationStateIpcChannels.updateWorkspaceMembership,
      workspaceId,
      membershipId,
      update
    ) as Promise<WorkspacesSnapshot>
  },
}

const workstreamsBridge: WorkstreamsBridge = {
  getSnapshot(workspaceId) {
    return ipcRenderer.invoke(workstreamsIpcChannels.getSnapshot, workspaceId)
  },
  previewWorktreeLocations(workspaceId, repositoryId) {
    return ipcRenderer.invoke(workstreamsIpcChannels.previewWorktreeLocations, { workspaceId, repositoryId })
  },
  createWorkstream(workspaceId, options) {
    return ipcRenderer.invoke(workstreamsIpcChannels.createWorkstream, {
      workspaceId,
      ...options,
    }) as Promise<WorkstreamCreationOutcome>
  },
  createQuickSession(workspaceId, options) {
    return ipcRenderer.invoke(workstreamsIpcChannels.createQuickSession, {
      workspaceId,
      ...options,
    }) as Promise<WorkstreamCreationOutcome>
  },
  createSession(workstreamId, options) {
    return ipcRenderer.invoke(workstreamsIpcChannels.createSession, {
      workstreamId,
      ...options,
    }) as Promise<WorkstreamCreationOutcome>
  },
  getSessionForkPoints(sessionId) {
    return ipcRenderer.invoke(workstreamsIpcChannels.getSessionForkPoints, { sessionId })
  },
  forkSession(sessionId, options) {
    return ipcRenderer.invoke(workstreamsIpcChannels.forkSession, {
      sessionId,
      ...options,
    }) as Promise<SessionForkOutcome>
  },
  setLifecycle(workstreamId, lifecycle) {
    return ipcRenderer.invoke(workstreamsIpcChannels.setLifecycle, { workstreamId, lifecycle })
  },
  renameSession(sessionId, title) {
    return ipcRenderer.invoke(workstreamsIpcChannels.renameSession, { sessionId, title })
  },
  showWorkingLocation(workstreamId, repositoryId) {
    return ipcRenderer.invoke(workstreamsIpcChannels.showWorkingLocation, { workstreamId, repositoryId })
  },
  subscribe(listener) {
    const handleChange = (_event: Electron.IpcRendererEvent, snapshot: WorkstreamsSnapshot) => listener(snapshot)

    ipcRenderer.on(workstreamsIpcChannels.changed, handleChange)

    return () => ipcRenderer.removeListener(workstreamsIpcChannels.changed, handleChange)
  },
}

const workstreamKnowledgeBridge: WorkstreamKnowledgeBridge = {
  get(workstreamId) {
    return ipcRenderer.invoke(workstreamKnowledgeIpcChannels.get, workstreamId)
  },
  mutate(workstreamId, command) {
    return ipcRenderer.invoke(workstreamKnowledgeIpcChannels.mutate, workstreamId, command)
  },
  subscribe(listener) {
    const handleChange = (_event: Electron.IpcRendererEvent, state: WorkstreamKnowledge) => listener(state)

    ipcRenderer.on(workstreamKnowledgeIpcChannels.changed, handleChange)

    return () => ipcRenderer.removeListener(workstreamKnowledgeIpcChannels.changed, handleChange)
  },
}

const composerBridge: ComposerBridge = {
  compact(sessionId) {
    return ipcRenderer.invoke(composerIpcChannels.compact, { sessionId })
  },
  submit(submission) {
    return ipcRenderer.invoke(composerIpcChannels.submit, submission) as Promise<SessionMessageSubmissionResult>
  },
  getCodeReviewDraft(sessionId) {
    return ipcRenderer.invoke(composerIpcChannels.getCodeReviewDraft, { sessionId })
  },
  saveCodeReviewComment(command) {
    return ipcRenderer.invoke(composerIpcChannels.saveCodeReviewComment, command)
  },
  removeCodeReviewComment(sessionId, commentId) {
    return ipcRenderer.invoke(composerIpcChannels.removeCodeReviewComment, { sessionId, commentId })
  },
  finishCodeReview(sessionId) {
    return ipcRenderer.invoke(composerIpcChannels.finishCodeReview, { sessionId })
  },
  stop(sessionId) {
    return ipcRenderer.invoke(composerIpcChannels.stop, { sessionId }) as Promise<SessionRunStopResult>
  },
  removeQueuedFollowUp(sessionId, followUpId) {
    return ipcRenderer.invoke(composerIpcChannels.removeQueuedFollowUp, { sessionId, followUpId }) as Promise<boolean>
  },
  resumeQueuedFollowUps(sessionId) {
    return ipcRenderer.invoke(composerIpcChannels.resumeQueuedFollowUps, { sessionId }) as Promise<boolean>
  },
}

const sessionSkillsBridge: SessionSkillsBridge = {
  getAvailable(sessionId) {
    return ipcRenderer.invoke(sessionSkillsIpcChannels.getAvailable, { sessionId })
  },
}

const sessionFilesBridge: SessionFilesBridge = {
  getAvailable(sessionId, query) {
    return ipcRenderer.invoke(sessionFilesIpcChannels.getAvailable, { sessionId, query })
  },
}

const sessionChangesBridge: SessionChangesBridge = {
  getSnapshot(sessionId) {
    return ipcRenderer.invoke(sessionChangesIpcChannels.getSnapshot, { sessionId }) as Promise<SessionChangesSnapshot>
  },
  loadFileDiff(sessionId, repositoryId, path, view) {
    return ipcRenderer.invoke(sessionChangesIpcChannels.loadFileDiff, {
      sessionId,
      repositoryId,
      path,
      view,
    }) as Promise<SessionFileDiff>
  },
  setFileStaged(sessionId, repositoryId, path, staged) {
    return ipcRenderer.invoke(sessionChangesIpcChannels.setFileStaged, {
      sessionId,
      repositoryId,
      path,
      staged,
    }) as Promise<SessionChangesSnapshot>
  },
}

const sessionConfigurationBridge: SessionConfigurationBridge = {
  getSnapshot(sessionId) {
    return ipcRenderer.invoke(sessionConfigurationIpcChannels.getSnapshot, {
      sessionId,
    }) as Promise<SessionConfigurationSnapshot>
  },
  setModel(sessionId, model) {
    return ipcRenderer.invoke(sessionConfigurationIpcChannels.setModel, {
      sessionId,
      model,
    }) as Promise<SessionConfigurationCommandResult>
  },
  setEffort(sessionId, effort) {
    return ipcRenderer.invoke(sessionConfigurationIpcChannels.setEffort, {
      sessionId,
      effort,
    }) as Promise<SessionConfigurationCommandResult>
  },
  dismissWarning(sessionId) {
    return ipcRenderer.invoke(sessionConfigurationIpcChannels.dismissWarning, {
      sessionId,
    }) as Promise<SessionConfigurationSnapshot>
  },
  subscribe(sessionId, listener) {
    const handleChange = (_event: Electron.IpcRendererEvent, mutation: SessionConfigurationMutation) =>
      listener(mutation)

    const channel = sessionConfigurationIpcChannels.changed(sessionId)
    ipcRenderer.on(channel, handleChange)

    return () => ipcRenderer.removeListener(channel, handleChange)
  },
}

const sessionTranscriptBridge: SessionTranscriptBridge = {
  getSnapshot(sessionId) {
    return ipcRenderer.invoke(sessionTranscriptIpcChannels.getSnapshot, {
      sessionId,
    }) as Promise<SessionTranscriptSnapshot>
  },
  getWorkingStateSnapshots() {
    return ipcRenderer.invoke(sessionTranscriptIpcChannels.getWorkingStateSnapshots) as Promise<
      readonly SessionWorkingStateSnapshot[]
    >
  },
  loadActivityDetails(sessionId, activityId) {
    return ipcRenderer.invoke(sessionTranscriptIpcChannels.loadActivityDetails, { sessionId, activityId }) as Promise<
      AgentActivityDetails | undefined
    >
  },
  acceptActionCard(sessionId, actionCardId) {
    return ipcRenderer.invoke(sessionTranscriptIpcChannels.acceptActionCard, {
      sessionId,
      actionCardId,
    }) as Promise<boolean>
  },
  openExternalLink(url) {
    return ipcRenderer.invoke(sessionTranscriptIpcChannels.openExternalLink, url) as Promise<void>
  },
  subscribe(listener) {
    const handleChange = (_event: Electron.IpcRendererEvent, mutation: SessionTranscriptMutation) => listener(mutation)
    ipcRenderer.on(sessionTranscriptIpcChannels.changed, handleChange)

    return () => ipcRenderer.removeListener(sessionTranscriptIpcChannels.changed, handleChange)
  },
}

const piWorkspaceBridge: PiWorkspaceBridge = {
  applicationState: applicationStateBridge,
  composer: composerBridge,
  sessionSkills: sessionSkillsBridge,
  sessionFiles: sessionFilesBridge,
  sessionChanges: sessionChangesBridge,
  sessionConfiguration: sessionConfigurationBridge,
  transcript: sessionTranscriptBridge,
  settings: settingsBridge,
  workstreams: workstreamsBridge,
  workstreamKnowledge: workstreamKnowledgeBridge,
}

contextBridge.exposeInMainWorld('piWorkspace', piWorkspaceBridge)
