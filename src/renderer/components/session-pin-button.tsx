import clsx from 'clsx'
import { Bookmark } from 'lucide-react'

type SessionPinButtonProperties = {
  sessionName: string
  pinned: boolean
  onToggle: () => void
  disabled?: boolean
  className?: string
}

export function SessionPinButton({
  sessionName,
  pinned,
  onToggle,
  disabled = false,
  className,
}: SessionPinButtonProperties) {
  const action = pinned ? 'Unpin' : 'Pin'

  return (
    <button
      type="button"
      aria-label={`${action} ${sessionName}`}
      aria-pressed={pinned}
      disabled={disabled}
      className={clsx(
        'rounded-sm p-1.5 text-session-pin hover:bg-session-interaction disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
        pinned && 'text-session-pin-active',
        className
      )}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <Bookmark aria-hidden="true" className={clsx('size-4', pinned && 'fill-current')} />
    </button>
  )
}
