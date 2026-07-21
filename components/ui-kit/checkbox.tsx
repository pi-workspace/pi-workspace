import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export function CheckboxGroup({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="control"
      {...props}
      className={clsx(
        className,
        // Basic groups
        'space-y-3',
        // With descriptions
        'has-data-[slot=description]:space-y-6 has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

export function CheckboxField({
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
  'relative isolate flex size-4.5 items-center justify-center rounded-[0.3125rem] sm:size-4',
  'before:absolute before:inset-0 before:-z-10 before:rounded-[0.3125rem] before:bg-control-background before:shadow-sm',
  'group-data-checked:before:bg-(--checkbox-checked-bg)',
  'border border-content-border group-data-checked:border-transparent group-data-hover:border-content-hover-border group-data-checked:bg-(--checkbox-checked-border)',
  'after:absolute after:inset-0 after:rounded-[0.3125rem] after:shadow-[inset_0_1px_color-mix(in_oklab,var(--theme-accent-foreground)_15%,transparent)]',
  'group-data-focus:outline-2 group-data-focus:outline-offset-2 group-data-focus:outline-focus-ring',
  'group-data-disabled:border-content-border group-data-disabled:bg-control-disabled-background group-data-disabled:opacity-50',
  'forced-colors:[--checkbox-check:HighlightText] forced-colors:[--checkbox-checked-bg:Highlight]',
]

const colors = {
  accent:
    '[--checkbox-check:var(--theme-accent-foreground)] [--checkbox-checked-bg:var(--theme-accent)] [--checkbox-checked-border:var(--theme-accent)]',
}

type Color = keyof typeof colors

export function Checkbox({
  color = 'accent',
  className,
  ...props
}: {
  color?: Color
  className?: string
} & Omit<Headless.CheckboxProps, 'as' | 'className'>) {
  return (
    <Headless.Checkbox
      data-slot="control"
      {...props}
      className={clsx(className, 'group inline-flex focus:outline-hidden')}
    >
      <span className={clsx([base, colors[color]])}>
        <svg
          className="size-4 stroke-(--checkbox-check) opacity-0 group-data-checked:opacity-100 sm:h-3.5 sm:w-3.5"
          viewBox="0 0 14 14"
          fill="none"
        >
          {/* Checkmark icon */}
          <path
            className="opacity-100 group-data-indeterminate:opacity-0"
            d="M3 8L6 11L11 3.5"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Indeterminate icon */}
          <path
            className="opacity-0 group-data-indeterminate:opacity-100"
            d="M3 7H11"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Headless.Checkbox>
  )
}
