import type { AgentSessionEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { TextContent } from '@earendil-works/pi-ai'
import { projectSessionSkillSelections, type SessionSkill } from '@/src/session-skills'
import type { SessionTranscriptMessage } from '@/src/session-transcript'

export type PiSessionMessageEvent = Readonly<{
  type: 'message-upsert'
  message: SessionTranscriptMessage
}>

type StreamedMessage = {
  id: string
  text: string
}

export function mapPiSessionMessageHistory(
  entries: readonly SessionEntry[],
  skills: readonly SessionSkill[] = []
): readonly SessionTranscriptMessage[] {
  return entries.flatMap((entry, index) => {
    if (entry.type !== 'message') {
      return []
    }

    const message = toSessionMessage(entry.message, entry.id, 'complete', index + 1, skills)

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
  revision: number,
  skills: readonly SessionSkill[]
): SessionTranscriptMessage | undefined {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return undefined
  }

  const content = textFromMessage(message)
  const projected = message.role === 'user' ? projectPiUserMessage(content, skills) : { text: content }

  if (!projected.text && !projected.skills?.length) {
    return undefined
  }

  return {
    id,
    role: message.role,
    ...projected,
    state,
    revision,
  }
}

export function projectPiUserMessage(
  source: string,
  skills: readonly SessionSkill[] = []
): Pick<SessionTranscriptMessage, 'text' | 'skills'> {
  const nativeInvocation = source.match(
    /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/
  )
  if (nativeInvocation) {
    const name = nativeInvocation[1] ?? ''
    return {
      text: nativeInvocation[2]?.trim() ?? '',
      skills: [{ offset: 0, skill: skillReference(name, skills) }],
    }
  }

  const blockPattern = /<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>/g
  const mentions: NonNullable<SessionTranscriptMessage['skills']>[number][] = []
  let text = ''
  let sourceOffset = 0

  for (const match of source.matchAll(blockPattern)) {
    const block = match[0]
    const name = match[1]
    const matchOffset = match.index
    if (!block || !name || matchOffset === undefined) continue

    text += source.slice(sourceOffset, matchOffset)
    mentions.push({ offset: text.length, skill: skillReference(name, skills) })
    sourceOffset = matchOffset + block.length
  }

  if (mentions.length > 0) return { text: text + source.slice(sourceOffset), skills: mentions }

  const projected = projectSessionSkillSelections(source)
  if (projected.selections.length === 0) return { text: source }

  return {
    text: projected.text,
    skills: projected.selections.map(({ name, offset }) => ({ offset, skill: skillReference(name, skills) })),
  }
}

function skillReference(name: string, skills: readonly SessionSkill[]) {
  const available = skills.find((skill) => skill.name === name)

  return available
    ? { ...available, availability: 'available' as const }
    : { name, availability: 'unavailable' as const }
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
