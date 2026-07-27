import type { ApplicationUpdateBridge } from '@/src/application-update'
import type { ComposerBridge } from '@/src/composer'
import type { ApplicationStateBridge } from '@/src/application-state-ipc'
import type { SessionConfigurationBridge } from '@/src/session-configuration'
import type { SessionSkillsBridge } from '@/src/session-skills'
import type { SessionChangesBridge } from '@/src/session-changes'
import type { SessionWorkingLocationsBridge } from '@/src/session-working-locations'
import type { SessionFilesBridge } from '@/src/session-files'
import type { SessionTranscriptBridge } from '@/src/session-transcript'
import type { SettingsBridge } from '@/src/settings'
import type { WorkstreamsBridge } from '@/src/workstreams'
import type { WorkstreamKnowledgeBridge } from '@/src/workstream-knowledge-ipc'

export type PiWorkspaceBridge = Readonly<{
  applicationState: ApplicationStateBridge
  applicationUpdate: ApplicationUpdateBridge
  composer: ComposerBridge
  sessionSkills: SessionSkillsBridge
  sessionFiles: SessionFilesBridge
  sessionChanges: SessionChangesBridge
  sessionWorkingLocations: SessionWorkingLocationsBridge
  sessionConfiguration: SessionConfigurationBridge
  transcript: SessionTranscriptBridge
  settings: SettingsBridge
  workstreams: WorkstreamsBridge
  workstreamKnowledge: WorkstreamKnowledgeBridge
}>
