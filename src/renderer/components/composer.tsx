import { Send, Square } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Combobox, ComboboxDescription, ComboboxLabel, ComboboxOption } from '@/components/ui-kit/combobox'
import { Listbox, ListboxOption } from '@/components/ui-kit/listbox'
import type { ComposerBridge, SessionMessageDelivery } from '@/src/composer'
import type { Session } from '@/src/domain/session'
import type { SessionContextUsage } from '@/src/session-transcript'
import type {
  SessionConfigurationBridge,
  SessionConfigurationCommandResult,
  SessionConfigurationEffort,
  SessionConfigurationModel,
  SessionConfigurationSnapshot,
} from '@/src/session-configuration'
import { ComposerEditor, type ComposerEditorHandle } from '@/src/renderer/components/composer-editor'
import { getComposerSubmissionState } from '@/src/renderer/composer-submission'
import type { SessionSkill, SessionSkillsBridge } from '@/src/session-skills'
import { useSessionConfiguration } from '@/src/renderer/session-configuration-state'

type ComposerProperties = Readonly<{
  session: Session
  draft: string
  focusRequest?: number
  isWorking: boolean
  contextUsage?: SessionContextUsage
  onActivate: () => void
  onDraftChange: (draft: string) => void
  submitMessage: ComposerBridge['submit']
  stopRun?: ComposerBridge['stop']
  sessionConfiguration?: SessionConfigurationBridge
  sessionSkills?: SessionSkillsBridge
}>

export function Composer({
  session,
  draft,
  focusRequest,
  isWorking,
  contextUsage,
  onActivate,
  onDraftChange,
  submitMessage,
  stopRun,
  sessionConfiguration,
  sessionSkills,
}: ComposerProperties) {
  const descriptionId = useId()
  const statusId = useId()
  const editorHandle = useRef<ComposerEditorHandle>(null)
  const currentDraft = useRef(draft)
  const awaitingAcceptance = useRef(false)
  const restoreFocusAfterAcceptance = useRef(false)
  const [submissionState, setSubmissionState] = useState(() => getComposerSubmissionState({ type: 'edit', draft }))
  const configuration = useSessionConfiguration(session.id, sessionConfiguration)
  const [pendingConfiguration, setPendingConfiguration] = useState<ReadonlySet<'model' | 'effort'>>(() => new Set())
  const [configurationError, setConfigurationError] = useState<string>()
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string>()
  const [availableSkills, setAvailableSkills] = useState<readonly SessionSkill[]>([])
  const [skillsError, setSkillsError] = useState<string>()
  const configurationPending = pendingConfiguration.size > 0

  useEffect(() => {
    currentDraft.current = draft
  }, [draft])

  useEffect(() => {
    if (!sessionSkills) return

    let active = true
    setAvailableSkills([])
    setSkillsError(undefined)

    void sessionSkills.getAvailable(session.id).then(
      (skills) => {
        if (active) setAvailableSkills(skills)
      },
      () => {
        if (active) setSkillsError('Skills could not be loaded for this Session.')
      }
    )

    return () => {
      active = false
    }
  }, [session.id, sessionSkills])

  useEffect(() => {
    if (focusRequest === undefined) {
      return
    }

    editorHandle.current?.focus()

    // Focus again after creation dialogs have finished closing and restoring
    // focus to their trigger.
    const frame = window.requestAnimationFrame(() => editorHandle.current?.focus())

    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest])

  useEffect(() => {
    if (!submissionState.awaiting && restoreFocusAfterAcceptance.current) {
      restoreFocusAfterAcceptance.current = false
      editorHandle.current?.focus()
    }
  }, [submissionState.awaiting])

  const updateDraft = useCallback(
    (nextDraft: string) => {
      currentDraft.current = nextDraft
      setSubmissionState(getComposerSubmissionState({ type: 'edit', draft: nextDraft }))
      onDraftChange(nextDraft)
    },
    [onDraftChange]
  )

  const submit = useCallback(
    async (delivery: SessionMessageDelivery) => {
      const submittedDraft = editorHandle.current?.getDraft() ?? currentDraft.current

      if (
        awaitingAcceptance.current ||
        configurationPending ||
        (configuration !== undefined && configuration.models.length === 0) ||
        submittedDraft.trim().length === 0
      ) {
        return
      }

      awaitingAcceptance.current = true
      setSubmissionState(getComposerSubmissionState({ type: 'submit', draft: submittedDraft }))

      let result

      try {
        result = await submitMessage({ sessionId: session.id, text: submittedDraft, delivery })
      } catch {
        result = { status: 'rejected', reason: 'unexpected' } as const
      }

      const nextSubmissionState = getComposerSubmissionState({ type: 'resolve', submittedDraft, result })
      currentDraft.current = nextSubmissionState.draft
      onDraftChange(nextSubmissionState.draft)
      awaitingAcceptance.current = false
      restoreFocusAfterAcceptance.current = true
      setSubmissionState(nextSubmissionState)
    },
    [configuration, configurationPending, onDraftChange, session.id, submitMessage]
  )

  const empty = draft.trim().length === 0
  const sendLabel = isWorking ? 'Steer session' : 'Send message'
  const { awaiting, error, status } = submissionState
  const configurationDisabled = isWorking || awaiting
  const agentRunDisabled = awaiting || configurationPending
  const modelConfigurationRequired = configuration !== undefined && configuration.models.length === 0
  const configurationMessage = modelConfigurationRequired
    ? 'No Model is available. Install Pi CLI, sign in to a provider, then restart Pi Workspace.'
    : undefined
  const errorMessage =
    error || stopError || configurationError || skillsError || configurationMessage || configuration?.persistenceWarning
  const statusMessage = errorMessage || status

  const changeConfiguration = useCallback(
    async (
      control: 'model' | 'effort',
      request: (bridge: SessionConfigurationBridge) => Promise<SessionConfigurationCommandResult>,
      failureMessage: string
    ) => {
      if (!sessionConfiguration || configurationDisabled || pendingConfiguration.has(control)) return

      setPendingConfiguration((pending) => new Set(pending).add(control))
      setConfigurationError(undefined)

      try {
        const result = await request(sessionConfiguration)

        if (result.status === 'rejected') setConfigurationError(result.message)
      } catch {
        setConfigurationError(failureMessage)
      } finally {
        setPendingConfiguration(
          (pending) => new Set([...pending].filter((pendingControl) => pendingControl !== control))
        )
      }
    },
    [configurationDisabled, pendingConfiguration, sessionConfiguration]
  )

  const changeModel = useCallback(
    (model: SessionConfigurationModel) =>
      changeConfiguration(
        'model',
        (bridge) => bridge.setModel(session.id, { provider: model.provider, id: model.id }),
        'The Model could not be changed.'
      ),
    [changeConfiguration, session.id]
  )

  const changeEffort = useCallback(
    (effort: SessionConfigurationEffort) =>
      changeConfiguration(
        'effort',
        (bridge) => bridge.setEffort(session.id, effort),
        'The Effort could not be changed.'
      ),
    [changeConfiguration, session.id]
  )

  const stop = useCallback(async () => {
    if (!stopRun || stopping) return

    setStopping(true)
    setStopError(undefined)

    try {
      await stopRun(session.id)
    } catch {
      setStopError('The Agent Run could not be stopped.')
    } finally {
      setStopping(false)
    }
  }, [session.id, stopRun, stopping])

  const dismissWarning = useCallback(() => {
    if (!sessionConfiguration) return

    void sessionConfiguration.dismissWarning(session.id)
  }, [session.id, sessionConfiguration])

  return (
    <div className="composer-tray shrink-0 border-t border-content-border p-3">
      <div
        aria-busy={agentRunDisabled ? 'true' : undefined}
        className="group flex min-h-[52px] flex-col rounded-xl border border-composer-border bg-composer-background transition-colors motion-reduce:transition-none hover:border-composer-interaction focus-within:border-composer-interaction"
        onClick={onActivate}
      >
        <ComposerEditor
          ref={editorHandle}
          availableSkills={availableSkills}
          describedBy={`${descriptionId} ${statusId}`}
          draft={draft}
          label={`Message for ${session.title}`}
          readOnly={agentRunDisabled}
          onChange={updateDraft}
          onFocus={onActivate}
          onSubmit={(delivery) => void submit(delivery)}
        />
        <div className="flex items-end justify-between gap-2 px-3 pt-1 pb-2" data-slot="composer-control-row">
          {(contextUsage || sessionConfiguration) && (
            <div className="flex min-w-0 items-end gap-3">
              {contextUsage && <ContextWindowUsage usage={contextUsage} />}
              {sessionConfiguration && (
                <ComposerConfigurationControls
                  snapshot={configuration}
                  disabled={configurationDisabled || modelConfigurationRequired}
                  pending={pendingConfiguration}
                  describedBy={statusId}
                  onModelChange={changeModel}
                  onEffortChange={changeEffort}
                />
              )}
            </div>
          )}
          <div className="ml-auto flex items-end gap-1">
            {isWorking && stopRun && (
              <button
                type="button"
                aria-label="Stop run"
                className="flex size-11 items-end justify-center rounded-lg text-composer-error-foreground outline-none transition-opacity motion-reduce:transition-none enabled:cursor-pointer focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-composer-background disabled:cursor-not-allowed disabled:opacity-50"
                disabled={stopping}
                onClick={(event) => {
                  event.stopPropagation()
                  void stop()
                }}
                title={stopping ? 'Stopping run…' : 'Stop run'}
              >
                <span className="flex size-9 items-center justify-center rounded-lg border border-composer-border bg-composer-background">
                  <Square aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
                </span>
              </button>
            )}
            <button
              type="button"
              aria-label={sendLabel}
              className="flex size-11 items-end justify-center rounded-lg text-composer-action-foreground outline-none transition-opacity motion-reduce:transition-none enabled:cursor-pointer focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-composer-background disabled:cursor-not-allowed disabled:opacity-35"
              disabled={empty || agentRunDisabled || modelConfigurationRequired}
              onClick={(event) => {
                event.stopPropagation()

                onActivate()
                void submit('steer')
              }}
              title={`${sendLabel} (Enter). Queue a follow-up with Alt+Enter.`}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-composer-action-background">
                <Send aria-hidden="true" className="size-4" strokeWidth={2.25} />
              </span>
            </button>
          </div>
        </div>
      </div>
      <p id={descriptionId} className="sr-only">
        Enter to send or steer. Shift+Enter for a new line. Alt+Enter to queue.
      </p>
      <div
        id={statusId}
        aria-live="polite"
        className={
          statusMessage
            ? `pt-1.5 text-xs/5 ${errorMessage ? 'text-composer-error-foreground' : 'text-composer-muted-foreground'}`
            : 'h-0 overflow-hidden'
        }
      >
        {statusMessage}
        {configuration?.persistenceWarning && (
          <button type="button" className="ml-2 underline" onClick={dismissWarning}>
            Dismiss warning
          </button>
        )}
      </div>
    </div>
  )
}

type ContextWindowUsageProperties = Readonly<{
  usage: SessionContextUsage
}>

function ContextWindowUsage({ usage }: ContextWindowUsageProperties) {
  const contextWindow = formatTokenCount(usage.contextWindow)

  if (usage.tokens === null || usage.percent === null) {
    return (
      <div aria-live="polite" className="min-w-28 text-xs/4 text-composer-muted-foreground">
        <p className="font-medium text-composer-foreground">Context</p>
        <p>Updating after compaction…</p>
        <p className="sr-only">Context window usage is unavailable until Pi finishes its next response.</p>
        <p className="mt-1 h-1 overflow-hidden rounded-full bg-content-subtle-background">
          <span className="block h-full w-1/3 animate-pulse rounded-full bg-content-muted-foreground motion-reduce:animate-none" />
        </p>
        <p className="mt-1">? / {contextWindow}</p>
      </div>
    )
  }

  const percent = Math.max(0, Math.min(100, usage.percent))
  const remaining = Math.max(0, usage.contextWindow - usage.tokens)
  const used = formatTokenCount(usage.tokens)
  const remainingText = `${formatTokenCount(remaining)} left`
  const valueText = `${used} used of ${contextWindow} tokens; ${remainingText}`

  return (
    <div aria-live="polite" className="min-w-28 text-xs/4 text-composer-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-composer-foreground">Context</span>
        <span>{remainingText}</span>
      </div>
      <div
        aria-label="Context window"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        aria-valuetext={valueText}
        className="mt-1 h-1 overflow-hidden rounded-full bg-content-subtle-background"
        role="progressbar"
      >
        <div className="h-full rounded-full bg-content-foreground" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1">
        {used} / {contextWindow}
      </p>
    </div>
  )
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}m`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`

  return String(tokens)
}

type ComposerConfigurationControlsProperties = Readonly<{
  snapshot?: SessionConfigurationSnapshot
  disabled: boolean
  pending: ReadonlySet<'model' | 'effort'>
  describedBy: string
  onModelChange: (model: SessionConfigurationModel) => void
  onEffortChange: (effort: SessionConfigurationEffort) => void
}>

function ComposerConfigurationControls({
  snapshot,
  disabled,
  pending,
  describedBy,
  onModelChange,
  onEffortChange,
}: ComposerConfigurationControlsProperties) {
  if (!snapshot) {
    return (
      <div
        className="composer-configuration-controls pointer-events-auto flex shrink-0 flex-col gap-2"
        aria-busy="true"
      >
        <div className="h-9 w-44" />
        <div className="h-9 w-24" />
        <span className="sr-only">Loading Model and Effort configuration.</span>
      </div>
    )
  }

  const selectedModel = snapshot?.models.find(
    (model) => model.provider === snapshot.model?.provider && model.id === snapshot.model.id
  )
  const modelsByProvider = Map.groupBy(snapshot.models, (model) => model.provider)
  const effortDisabled =
    disabled ||
    pending.has('effort') ||
    (snapshot.supportedEfforts.length === 1 && snapshot.supportedEfforts[0] === 'off')

  return (
    <div
      aria-busy={pending.size > 0 ? 'true' : undefined}
      className="composer-configuration-controls pointer-events-auto flex shrink-0 flex-col gap-2"
    >
      <div className="w-44">
        <Combobox<SessionConfigurationModel>
          aria-label="Model"
          describedBy={describedBy}
          options={[...modelsByProvider.values()].flat()}
          value={selectedModel}
          disabled={disabled || pending.has('model')}
          displayValue={(model) => (model ? model.name : '')}
          filter={(model, query) =>
            `${model.name} ${model.providerName} ${model.id}`.toLowerCase().includes(query.toLowerCase())
          }
          onChange={(model: SessionConfigurationModel | null) => {
            if (model) onModelChange(model)
          }}
          className="w-full"
        >
          {(model) => (
            <>
              {modelsByProvider.get(model.provider)?.[0] === model && (
                <div className="px-3 pt-2 text-xs font-semibold text-content-muted-foreground">
                  {model.providerName}
                </div>
              )}
              <ComboboxOption value={model}>
                <ComboboxLabel>{model.name}</ComboboxLabel>
                <ComboboxDescription>{`${model.providerName} · ${model.id}`}</ComboboxDescription>
              </ComboboxOption>
            </>
          )}
        </Combobox>
      </div>
      <div className="w-24">
        <Listbox
          aria-label="Effort"
          describedBy={describedBy}
          value={snapshot?.effort ?? 'off'}
          disabled={effortDisabled}
          onChange={(effort) => onEffortChange(effort)}
          className="w-full"
        >
          {snapshot.supportedEfforts.map((effort) => (
            <ListboxOption key={effort} value={effort}>
              {effort === 'off' ? 'Off' : effort[0]?.toUpperCase() + effort.slice(1)}
            </ListboxOption>
          ))}
        </Listbox>
      </div>
    </div>
  )
}
