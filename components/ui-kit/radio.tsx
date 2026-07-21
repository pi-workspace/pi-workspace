import * as Headless from '@headlessui/react'
import clsx from 'clsx'

export function RadioGroup({
  className,
  ...props
}: { className?: string } & Omit<Headless.RadioGroupProps, 'as' | 'className'>) {
  return (
    <Headless.RadioGroup
      data-slot="control"
      {...props}
      className={clsx(
        className,
        // Basic groups
        'space-y-3 **:data-[slot=label]:font-normal',
        // With descriptions
        'has-data-[slot=description]:space-y-6 has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

export function RadioField({
  className,
  ...props
}: { className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>) {
  return (
    <Headless.Field
      data-slot="field"
      {...props}
      className={clsx(
        className,
        // Base layout
        'grid grid-cols-[1.125rem_1fr] gap-x-4 gap-y-1 sm:grid-cols-[1rem_1fr]',
        // Control layout
        '*:data-[slot=control]:col-start-1 *:data-[slot=control]:row-start-1 *:data-[slot=control]:mt-0.75 sm:*:data-[slot=control]:mt-1',
        // Label layout
        '*:data-[slot=label]:col-start-2 *:data-[slot=label]:row-start-1',
        // Description layout
        '*:data-[slot=description]:col-start-2 *:data-[slot=description]:row-start-2',
        // With description
        'has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

const base = [
  'relative isolate flex size-4.75 shrink-0 rounded-full sm:size-4.25',
  'before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-control-background before:shadow-sm',
  'group-data-checked:before:bg-(--radio-checked-bg)',
  'border border-content-border group-data-checked:border-transparent group-data-hover:border-content-hover-border group-data-checked:bg-(--radio-checked-border)',
  'after:absolute after:inset-0 after:rounded-full after:shadow-[inset_0_1px_color-mix(in_oklab,var(--theme-accent-foreground)_15%,transparent)]',
  '[--radio-indicator:transparent] group-data-checked:[--radio-indicator:var(--radio-checked-indicator)] group-data-hover:[--radio-indicator:var(--theme-content-interaction-strong)]',
  'group-data-focus:outline-2 group-data-focus:outline-offset-2 group-data-focus:outline-focus-ring',
  'group-data-disabled:border-content-border group-data-disabled:bg-control-disabled-background group-data-disabled:opacity-50',
  'forced-colors:[--radio-checked-indicator:HighlightText] forced-colors:[--radio-checked-bg:Highlight]',
]

const colors = {
  accent:
    '[--radio-checked-indicator:var(--theme-accent-foreground)] [--radio-checked-bg:var(--theme-accent)] [--radio-checked-border:var(--theme-accent)]',
}

type Color = keyof typeof colors

export function Radio({
  color = 'accent',
  className,
  ...props
}: { color?: Color; className?: string } & Omit<Headless.RadioProps, 'as' | 'className' | 'children'>) {
  return (
    <Headless.Radio
      data-slot="control"
      {...props}
      className={clsx(className, 'group inline-flex focus:outline-hidden')}
    >
      <span className={clsx([base, colors[color]])}>
        <span
          className={clsx(
            'size-full rounded-full border-[4.5px] border-transparent bg-(--radio-indicator) bg-clip-padding',
            // Forced colors mode
            'forced-colors:border-[Canvas] forced-colors:group-data-checked:border-[Highlight]'
          )}
        />
      </span>
    </Headless.Radio>
  )
}
