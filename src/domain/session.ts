declare const sessionIdBrand: unique symbol

/** Session ids crossing IPC are compact, printable identifiers. */
export const maximumSessionIdLength = 128
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export type SessionId = string & {
  readonly [sessionIdBrand]: typeof sessionIdBrand
}

/** The renderer-safe summary of a Session. */
export type Session = Readonly<{
  id: SessionId
  title: string
}>

export function sessionId(value: string): SessionId {
  return value as SessionId
}

export function isSessionId(value: unknown): value is SessionId {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumSessionIdLength &&
    sessionIdPattern.test(value)
  )
}
