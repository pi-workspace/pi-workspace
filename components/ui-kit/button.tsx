import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from '@/components/ui-kit/link'

const styles = {
  base: [
    'relative isolate inline-flex items-baseline justify-center gap-x-2 rounded-lg border text-base/6 font-semibold',
    'px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6',
    'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-focus-ring',
    'data-disabled:opacity-50',
    '*:data-[slot=icon]:-mx-0.5 *:data-[slot=icon]:my-0.5 *:data-[slot=icon]:size-5 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-(--btn-icon) sm:*:data-[slot=icon]:my-1 sm:*:data-[slot=icon]:size-4 forced-colors:[--btn-icon:ButtonText] forced-colors:data-hover:[--btn-icon:ButtonText]',
  ],
  solid: [
    'border-transparent bg-(--btn-border)',
    'before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-lg)-1px)] before:bg-(--btn-bg) before:shadow-sm',
    'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-lg)-1px)] after:shadow-[inset_0_1px_color-mix(in_oklab,var(--theme-accent-foreground)_15%,transparent)]',
    'data-active:after:bg-(--btn-hover-overlay) data-hover:after:bg-(--btn-hover-overlay)',
    'data-disabled:before:shadow-none data-disabled:after:shadow-none',
  ],
  outline: [
    'border-content-border text-content-foreground data-active:bg-content-interaction data-hover:bg-content-interaction',
    '[--btn-icon:var(--theme-content-muted-foreground)] data-active:[--btn-icon:var(--theme-content-foreground)] data-hover:[--btn-icon:var(--theme-content-foreground)]',
  ],
  plain: [
    'border-transparent text-content-foreground data-active:bg-content-interaction-strong data-hover:bg-content-interaction-strong',
    '[--btn-icon:var(--theme-content-muted-foreground)] data-active:[--btn-icon:var(--theme-content-foreground)] data-hover:[--btn-icon:var(--theme-content-foreground)]',
  ],
  colors: {
    accent: [
      'text-accent-foreground [--btn-bg:var(--theme-accent)] [--btn-border:var(--theme-accent)] [--btn-hover-overlay:color-mix(in_oklab,var(--theme-accent-foreground)_12%,transparent)]',
      '[--btn-icon:var(--theme-accent-foreground)]',
    ],
    red: [
      'text-danger-on-background [--btn-bg:var(--theme-danger-background)] [--btn-border:var(--theme-danger-border)] [--btn-hover-overlay:color-mix(in_oklab,var(--theme-danger-on-background)_12%,transparent)]',
      '[--btn-icon:var(--theme-danger-on-background)]',
    ],
  },
}

type ButtonProps = (
  | { color?: keyof typeof styles.colors; outline?: never; plain?: never }
  | { color?: never; outline: true; plain?: never }
  | { color?: never; outline?: never; plain: true }
) & { className?: string; children: React.ReactNode } & (
    | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
    | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
  )

export const Button = forwardRef(function Button(
  { color, outline, plain, className, children, ...props }: ButtonProps,
  ref: React.ForwardedRef<HTMLElement>
) {
  let classes = clsx(
    className,
    styles.base,
    outline ? styles.outline : plain ? styles.plain : clsx(styles.solid, styles.colors[color ?? 'accent'])
  )

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>{children}</TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={clsx(classes, 'cursor-default')} ref={ref}>
      <TouchTarget>{children}</TouchTarget>
    </Headless.Button>
  )
})

/**
 * Expand the hit area to at least 44×44px on touch devices
 */
export function TouchTarget({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span
        className="absolute top-1/2 left-1/2 size-[max(100%,2.75rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
      {children}
    </>
  )
}
