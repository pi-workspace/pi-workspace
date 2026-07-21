import { useEffect, useRef } from 'react'

type SessionTitleEditorProperties = Readonly<{
  title: string
  error?: string
  saving: boolean
  onChange: (title: string) => void
  onSave: () => void
  onCancel: () => void
}>

export function SessionTitleEditor({ title, error, saving, onChange, onSave, onCancel }: SessionTitleEditorProperties) {
  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const cancelling = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <span className="min-w-0 flex-1">
      <input
        ref={inputRef}
        type="text"
        value={title}
        aria-label="Session title"
        aria-invalid={error ? 'true' : undefined}
        aria-busy={saving ? 'true' : undefined}
        disabled={saving}
        className={`w-full rounded-sm border bg-content-background px-1 text-sm/6 text-content-foreground outline-none focus-visible:ring-2 disabled:cursor-wait ${
          error
            ? 'border-composer-error-foreground focus-visible:ring-composer-error-foreground'
            : 'border-content-border focus-visible:ring-focus-ring'
        }`}
        onChange={(event) => onChange(event.currentTarget.value)}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelling.current = true
            onCancel()
          }

          if (event.key === 'Enter' && !composing.current && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSave()
          }
        }}
        onBlur={() => {
          if (cancelling.current) {
            cancelling.current = false
            return
          }

          onSave()
        }}
      />
      {saving && (
        <span className="sr-only" aria-live="polite">
          Saving title…
        </span>
      )}
    </span>
  )
}
