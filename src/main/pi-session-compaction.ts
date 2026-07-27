import { findCutPoint, sessionEntryToContextMessages, type SessionEntry } from '@earendil-works/pi-coding-agent'

export function canCompactSessionHistory(
  entries: readonly SessionEntry[],
  settings: Readonly<{ keepRecentTokens: number }>
): boolean {
  if (entries.at(-1)?.type === 'compaction') return false

  const previousCompactionIndex = entries.findLastIndex((entry) => entry.type === 'compaction')
  let boundaryStart = 0

  if (previousCompactionIndex >= 0) {
    const previousCompaction = entries[previousCompactionIndex]

    if (previousCompaction?.type === 'compaction') {
      const firstKeptEntryIndex = entries.findIndex((entry) => entry.id === previousCompaction.firstKeptEntryId)
      boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : previousCompactionIndex + 1
    }
  }

  const cutPoint = findCutPoint([...entries], boundaryStart, entries.length, settings.keepRecentTokens)

  return entries
    .slice(boundaryStart, cutPoint.firstKeptEntryIndex)
    .some((entry) => entry.type !== 'compaction' && sessionEntryToContextMessages(entry).length > 0)
}
