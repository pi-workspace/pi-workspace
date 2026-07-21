type PersistedAssistantState = Readonly<{
  stopReason: string
  content: readonly Readonly<{ type: string }>[]
}>

export type PersistedAgentState = 'completed' | 'failed' | 'cancelled' | 'indeterminate'

export function classifyPersistedAgentState(lastAssistant: PersistedAssistantState | undefined): PersistedAgentState {
  if (lastAssistant?.stopReason === 'error') return 'failed'
  if (lastAssistant?.stopReason === 'aborted') return 'cancelled'

  if (
    lastAssistant &&
    (lastAssistant.stopReason === 'stop' || lastAssistant.stopReason === 'length') &&
    !lastAssistant.content.some((part) => part.type === 'toolCall')
  ) {
    return 'completed'
  }

  return 'indeterminate'
}
