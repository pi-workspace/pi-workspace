export function normalizeSessionDescription(value: string): string | undefined {
  const description = value.replace(/\s+/g, ' ').trim()

  return description.length > 0 ? description : undefined
}
