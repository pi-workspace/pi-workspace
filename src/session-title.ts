export function normalizeSessionTitle(value: string): string | undefined {
  const title = value.replace(/[\r\n]+/g, ' ').trim()

  return title.length > 0 ? title : undefined
}
