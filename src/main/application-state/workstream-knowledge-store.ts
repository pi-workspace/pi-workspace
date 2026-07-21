import { randomUUID } from 'node:crypto'
import type { WorkstreamKnowledgeRecord, WorkstreamKnowledgeRecordDraft } from '@/src/domain/workstream-knowledge'
import {
  applyPiWorkstreamKnowledgeCommand,
  applyWorkstreamKnowledgeCommand,
  deriveWorkstreamKnowledgeReadiness,
  type SpecificationVersion,
  type WorkstreamKnowledge,
  type WorkstreamKnowledgeCommand,
  type WorkstreamKnowledgeCommandContext,
  type WorkstreamKnowledgeMutationResult,
} from '@/src/domain/workstream-knowledge-transitions'
import type { SqliteDatabase } from './sqlite'

export const workstreamKnowledgeSchemaSql = `
  CREATE TABLE workstream_knowledge (workstream_id TEXT PRIMARY KEY REFERENCES workstreams(id), knowledge_revision INTEGER NOT NULL, specification_revision INTEGER NOT NULL, approved_version_id TEXT);
  CREATE TABLE workstream_records (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), kind TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, tombstoned INTEGER NOT NULL, actor TEXT NOT NULL, session_id TEXT, recorded_at INTEGER NOT NULL);
  CREATE TABLE workstream_record_history (record_id TEXT NOT NULL, workstream_id TEXT NOT NULL REFERENCES workstreams(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, tombstoned INTEGER NOT NULL, actor TEXT NOT NULL, session_id TEXT, recorded_at INTEGER NOT NULL, PRIMARY KEY (record_id, revision));
  CREATE TABLE workstream_mutations (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), knowledge_revision INTEGER NOT NULL, command_type TEXT NOT NULL, record_id TEXT, actor TEXT NOT NULL, session_id TEXT, payload TEXT NOT NULL, recorded_at INTEGER NOT NULL);
  CREATE TABLE specification_versions (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), version INTEGER NOT NULL, knowledge_revision INTEGER NOT NULL, specification_revision INTEGER NOT NULL, readiness TEXT NOT NULL, records TEXT NOT NULL, approved_at INTEGER NOT NULL, UNIQUE(workstream_id, version));
`

export const workstreamKnowledgeTableNames = [
  'workstream_knowledge',
  'workstream_records',
  'workstream_record_history',
  'workstream_mutations',
  'specification_versions',
] as const

export function initializeStoredWorkstreamKnowledge(database: SqliteDatabase, workstreamId: string): void {
  database
    .prepare(
      'INSERT INTO workstream_knowledge (workstream_id, knowledge_revision, specification_revision) VALUES (?, 0, 0)'
    )
    .run(workstreamId)
}

export function assertRepositoryMembershipRemovalAllowed(
  database: SqliteDatabase,
  workspaceId: string,
  repositoryId: string
): void {
  const affectedWorkstream = database
    .prepare(
      `SELECT w.id
         FROM workstreams w
        WHERE w.workspace_id = ?
          AND w.lifecycle = 'active'
          AND EXISTS (
            SELECT 1
              FROM (
                SELECT s.repository_id AS repository_id
                  FROM sessions s
                 WHERE s.workstream_id = w.id AND s.mode = 'default'
                UNION
                SELECT json_extract(wr.payload, '$.repositoryId')
                  FROM workstream_records wr
                 WHERE wr.workstream_id = w.id AND wr.kind = 'repository-impact' AND wr.tombstoned = 0
                UNION
                SELECT location.repository_id
                  FROM workstream_repository_locations location
                 WHERE location.workstream_id = w.id AND location.kind = 'worktree'
              ) current_repositories
             WHERE current_repositories.repository_id = ?
          )
        LIMIT 1`
    )
    .get(workspaceId, repositoryId)

  if (affectedWorkstream) throw new TypeError('The Repository membership is used by an active Workstream.')
}

export function readCurrentWorkstreamRepositorySet(database: SqliteDatabase, workstreamId: string): readonly string[] {
  const rows = database
    .prepare(
      `SELECT repository_id
         FROM (
           SELECT s.repository_id AS repository_id
             FROM sessions s
            WHERE s.workstream_id = ? AND s.mode = 'default'
           UNION
           SELECT json_extract(wr.payload, '$.repositoryId') AS repository_id
             FROM workstream_records wr
            WHERE wr.workstream_id = ? AND wr.kind = 'repository-impact' AND wr.tombstoned = 0
           UNION
           SELECT location.repository_id
             FROM workstream_repository_locations location
            WHERE location.workstream_id = ? AND location.kind = 'worktree'
         )
        WHERE repository_id IS NOT NULL
        ORDER BY repository_id`
    )
    .all(workstreamId, workstreamId, workstreamId)

  return rows.map((row) => String(row.repository_id))
}

export function readWorkstreamKnowledge(database: SqliteDatabase, workstreamId: string): WorkstreamKnowledge {
  const workstream = database.prepare('SELECT goal FROM workstreams WHERE id = ?').get(workstreamId)
  const knowledge = database
    .prepare(
      'SELECT knowledge_revision, specification_revision, approved_version_id FROM workstream_knowledge WHERE workstream_id = ?'
    )
    .get(workstreamId)

  if (!workstream || typeof workstream.goal !== 'string' || !knowledge) {
    throw new TypeError('The goal-based Workstream knowledge no longer exists.')
  }

  const knowledgeRevision = Number(knowledge.knowledge_revision)
  const specificationRevision = Number(knowledge.specification_revision)

  if (
    !Number.isSafeInteger(knowledgeRevision) ||
    knowledgeRevision < 0 ||
    !Number.isSafeInteger(specificationRevision) ||
    specificationRevision < 0
  ) {
    throw new Error('The persisted Workstream knowledge revisions are malformed.')
  }

  const records = database
    .prepare(
      `SELECT id, revision, payload, tombstoned, actor
         FROM workstream_records
        WHERE workstream_id = ?
        ORDER BY recorded_at, id`
    )
    .all(workstreamId)
    .map((row) => {
      const record = parseJson<WorkstreamKnowledgeRecord>(row.payload, 'Workstream record')
      if (
        record.id !== row.id ||
        record.revision !== Number(row.revision) ||
        record.tombstoned !== (Number(row.tombstoned) === 1) ||
        record.provenance.actor !== row.actor
      ) {
        throw new Error('The persisted Workstream record is inconsistent.')
      }
      return record
    })

  const specificationVersions: readonly SpecificationVersion[] = database
    .prepare(
      `SELECT id, workstream_id, version, knowledge_revision, specification_revision, readiness, records, approved_at
         FROM specification_versions
        WHERE workstream_id = ?
        ORDER BY version`
    )
    .all(workstreamId)
    .map((version) => ({
      id: String(version.id),
      workstreamId: String(version.workstream_id),
      version: Number(version.version),
      knowledgeRevision: Number(version.knowledge_revision),
      specificationRevision: Number(version.specification_revision),
      readiness: parseJson(version.readiness, 'specification readiness'),
      records: parseJson<readonly WorkstreamKnowledgeRecord[]>(version.records, 'specification records'),
      approvedAt: Number(version.approved_at),
    }))
  const approvedVersion =
    typeof knowledge.approved_version_id === 'string'
      ? specificationVersions.find((version) => version.id === knowledge.approved_version_id)
      : undefined

  if (typeof knowledge.approved_version_id === 'string' && !approvedVersion) {
    throw new Error('The approved Workstream specification is missing.')
  }

  return {
    workstreamId,
    goal: String(workstream.goal),
    knowledgeRevision,
    specificationRevision,
    specificationVersion: specificationVersions.at(-1)?.version ?? 0,
    currentRepositoryIds: readCurrentWorkstreamRepositorySet(database, workstreamId),
    records,
    specificationVersions,
    ...(approvedVersion ? { approvedVersion } : {}),
  }
}

export function applyStoredWorkstreamKnowledgeCommand(
  database: SqliteDatabase,
  workstreamId: string,
  command: WorkstreamKnowledgeCommand,
  context: WorkstreamKnowledgeCommandContext
): WorkstreamKnowledgeMutationResult {
  try {
    database.exec('BEGIN IMMEDIATE;')
    const sessionMode =
      context.actor === 'pi' ? assertPiWorkstreamSession(database, workstreamId, context.sessionId) : undefined
    assertRecordRepositoriesBelongToWorkspace(database, workstreamId, command)

    const current = readWorkstreamKnowledge(database, workstreamId)
    if (context.actor === 'pi') assertPiCommandMode(current, command, sessionMode!)
    const result =
      context.actor === 'pi'
        ? applyPiWorkstreamKnowledgeCommand(current, command, { at: context.at, sessionId: context.sessionId })
        : applyWorkstreamKnowledgeCommand(current, command, context)

    persistWorkstreamKnowledgeMutation(database, current, result, command, context)
    const persistedState = readWorkstreamKnowledge(database, workstreamId)
    const persistedResult = {
      ...result,
      knowledge: persistedState,
      specificationReadiness: deriveWorkstreamKnowledgeReadiness(persistedState),
    }
    database.exec('COMMIT;')
    return persistedResult
  } catch (error) {
    try {
      database.exec('ROLLBACK;')
    } catch {
      // The adapter may already have closed an interrupted transaction.
    }
    throw error
  }
}

function assertPiWorkstreamSession(
  database: SqliteDatabase,
  workstreamId: string,
  sessionId: string | undefined
): 'brainstorm' | 'implement' {
  const session = database
    .prepare("SELECT mode FROM sessions WHERE id = ? AND workstream_id = ? AND mode IN ('brainstorm', 'implement')")
    .get(sessionId ?? null, workstreamId)

  if (!session) throw new TypeError('Pi mutations require an owning Brainstorm or Implement Session.')
  return session.mode === 'brainstorm' ? 'brainstorm' : 'implement'
}

function assertRecordRepositoriesBelongToWorkspace(
  database: SqliteDatabase,
  workstreamId: string,
  command: WorkstreamKnowledgeCommand
): void {
  if (command.type !== 'put-record') return

  for (const repositoryId of new Set(recordRepositoryIds(command.record))) {
    const membership = database
      .prepare(
        `SELECT 1
           FROM workstreams w
           JOIN workspace_repositories m ON m.workspace_id = w.workspace_id
          WHERE w.id = ? AND m.repository_id = ?`
      )
      .get(workstreamId, repositoryId)

    if (!membership) throw new TypeError('Workstream records must reference Repositories in their Workspace.')
  }
}

function recordRepositoryIds(record: WorkstreamKnowledgeRecordDraft): readonly string[] {
  if (record.kind === 'evidence' && record.source.kind === 'repository') return [record.source.repositoryId]
  if (record.kind === 'repository-impact' || record.kind === 'validation-requirement') return [record.repositoryId]
  if (record.kind === 'finding' || record.kind === 'plan-step' || record.kind === 'execution-progress') {
    return record.repositoryIds
  }

  return []
}

function assertPiCommandMode(
  knowledge: WorkstreamKnowledge,
  command: WorkstreamKnowledgeCommand,
  mode: 'brainstorm' | 'implement'
): void {
  if (mode === 'implement') return

  const targetsExecutionProgress =
    (command.type === 'put-record' && command.record.kind === 'execution-progress') ||
    ('recordId' in command &&
      knowledge.records.some((record) => record.id === command.recordId && record.kind === 'execution-progress'))
  if (targetsExecutionProgress) throw new TypeError('Execution Progress is Implement-only.')
}

function persistWorkstreamKnowledgeMutation(
  database: SqliteDatabase,
  previous: WorkstreamKnowledge,
  result: WorkstreamKnowledgeMutationResult,
  command: WorkstreamKnowledgeCommand,
  context: WorkstreamKnowledgeCommandContext
): void {
  const approvedVersionId = result.knowledge.approvedVersion?.id ?? null
  database
    .prepare(
      'UPDATE workstream_knowledge SET knowledge_revision = ?, specification_revision = ?, approved_version_id = ? WHERE workstream_id = ?'
    )
    .run(
      result.knowledge.knowledgeRevision,
      result.knowledge.specificationRevision,
      approvedVersionId,
      result.knowledge.workstreamId
    )

  if (result.changedRecordId) {
    const record = result.knowledge.records.find((candidate) => candidate.id === result.changedRecordId)
    if (!record) throw new Error('The Workstream mutation did not retain its changed record.')

    const payload = JSON.stringify(record)
    database
      .prepare(
        `INSERT INTO workstream_records
          (id, workstream_id, kind, revision, payload, tombstoned, actor, session_id, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind, revision = excluded.revision, payload = excluded.payload,
           tombstoned = excluded.tombstoned, actor = excluded.actor, session_id = excluded.session_id,
           recorded_at = excluded.recorded_at`
      )
      .run(
        record.id,
        result.knowledge.workstreamId,
        record.kind,
        record.revision,
        payload,
        record.tombstoned ? 1 : 0,
        record.provenance.actor,
        record.provenance.sessionId ?? null,
        record.provenance.at
      )
    database
      .prepare(
        `INSERT INTO workstream_record_history
          (record_id, workstream_id, revision, kind, payload, tombstoned, actor, session_id, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        result.knowledge.workstreamId,
        record.revision,
        record.kind,
        payload,
        record.tombstoned ? 1 : 0,
        record.provenance.actor,
        record.provenance.sessionId ?? null,
        record.provenance.at
      )
  }

  if (result.knowledge.approvedVersion && result.knowledge.approvedVersion.id !== previous.approvedVersion?.id) {
    const version = result.knowledge.approvedVersion
    database
      .prepare(
        `INSERT INTO specification_versions
          (id, workstream_id, version, knowledge_revision, specification_revision, readiness, records, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        version.id,
        version.workstreamId,
        version.version,
        version.knowledgeRevision,
        version.specificationRevision,
        JSON.stringify(version.readiness),
        JSON.stringify(version.records),
        version.approvedAt
      )
  }

  database
    .prepare(
      `INSERT INTO workstream_mutations
        (id, workstream_id, knowledge_revision, command_type, record_id, actor, session_id, payload, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      result.knowledge.workstreamId,
      result.knowledge.knowledgeRevision,
      command.type,
      result.changedRecordId ?? null,
      context.actor,
      context.sessionId ?? null,
      JSON.stringify(command),
      context.at
    )
}

function parseJson<T>(value: unknown, label: string): T {
  try {
    return JSON.parse(String(value)) as T
  } catch {
    throw new Error(`The persisted ${label} is malformed.`)
  }
}
