import type { AgentSessionEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { TextContent } from '@earendil-works/pi-ai'
import type { SessionTranscriptMessage } from '@/src/session-transcript'

export type PiSessionMessageEvent = Readonly<{
  type: 'message-upsert'
  message: SessionTranscriptMessage
}>

type StreamedMessage = {
  id: string
  text: string
}

export function mapPiSessionMessageHistory(entries: readonly SessionEntry[]): readonly SessionTranscriptMessage[] {
  return entries.flatMap((entry, index) => {
    if (entry.type !== 'message') {
      return []
    }

    const message = toSessionMessage(entry.message, entry.id, 'complete', index + 1)

    return message ? [message] : []
  })
}

export function createPiSessionMessageStream(): { handle(event: AgentSessionEvent): readonly PiSessionMessageEvent[] } {
  let activeAssistantStream: StreamedMessage | undefined
  let nextMessageId = 0
  let nextRevision = 0

  function streamFor(message: AgentMessage): StreamedMessage | undefined {
    if (message.role !== 'assistant') {
      return undefined
    }

    if (activeAssistantStream) {
      return activeAssistantStream
    }

    const stream: StreamedMessage = {
      id: `${message.role}-${message.timestamp ?? `stream-${nextMessageId++}`}`,
      text: '',
    }

    activeAssistantStream = stream

    return stream
  }

  function messageUpdate(
    stream: StreamedMessage,
    text: string,
    state: SessionTranscriptMessage['state']
  ): PiSessionMessageEvent {
    stream.text = text

    return {
      type: 'message-upsert',
      message: {
        ...stream,
        role: 'assistant',
        text,
        state,
        revision: ++nextRevision,
      },
    }
  }

  return {
    handle(event) {
      if (event.type === 'message_start' && event.message.role === 'assistant') {
        streamFor(event.message)

        return []
      }

      if (
        event.type === 'message_update' &&
        event.message.role === 'assistant' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        if (event.assistantMessageEvent.delta.length === 0) {
          return []
        }

        const stream = streamFor(event.message)

        if (!stream) {
          return []
        }

        return [messageUpdate(stream, `${stream.text}${event.assistantMessageEvent.delta}`, 'streaming')]
      }

      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const stream = streamFor(event.message)
        const text = textFromMessage(event.message)

        activeAssistantStream = undefined

        if (!stream || !text) {
          return []
        }

        return [messageUpdate(stream, text, 'complete')]
      }

      if (event.type === 'agent_end' && !event.willRetry) return []

      return []
    },
  }
}

function toSessionMessage(
  message: AgentMessage,
  id: string,
  state: SessionTranscriptMessage['state'],
  revision: number
): SessionTranscriptMessage | undefined {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return undefined
  }

  const text = textFromMessage(message)

  if (!text) {
    return undefined
  }

  return {
    id,
    role: message.role,
    text,
    state,
    revision,
  }
}

function textFromMessage(message: Extract<AgentMessage, { role: 'user' | 'assistant' }>): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  return message.content
    .filter((content): content is TextContent => content.type === 'text')
    .map((content) => content.text)
    .join('')
}
