import { X } from 'lucide-react'
import type { SessionFileReference } from '@/src/session-files'

type FileReferenceProperties = Readonly<{
  file: SessionFileReference
  onRemove?: () => void
}>

export function FileReference({ file, onRemove }: FileReferenceProperties) {
  const description = file.availability === 'available' ? file.kind : 'This file or folder is no longer available.'

  return (
    <span
      className="group/file inline-flex max-w-full cursor-default items-center align-baseline"
      contentEditable={false}
      data-file-reference={file.path}
    >
      <span
        className="truncate border-b border-skill-reference-underline font-medium text-skill-reference-foreground"
        title={description}
      >
        @{file.path}
      </span>
      {onRemove ? (
        <span className="grid max-w-0 grid-cols-[1.25rem] overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 motion-reduce:transition-none group-hover/file:max-w-5 group-hover/file:opacity-100 group-focus-within/file:max-w-5 group-focus-within/file:opacity-100">
          <button
            type="button"
            aria-label={`Remove ${file.path}`}
            className="ml-0.5 flex size-5 items-center justify-center rounded-sm text-composer-muted-foreground outline-none hover:bg-composer-interaction hover:text-skill-reference-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={onRemove}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ) : null}
    </span>
  )
}
