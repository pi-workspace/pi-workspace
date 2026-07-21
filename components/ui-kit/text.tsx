import clsx from 'clsx'
import { Link } from '@/components/ui-kit/link'

export function Text({ className, ...props }: React.ComponentPropsWithoutRef<'p'>) {
  return (
    <p
      data-slot="text"
      {...props}
      className={clsx(className, 'text-base/6 text-content-muted-foreground sm:text-sm/6 ')}
    />
  )
}

export function TextLink({ className, ...props }: React.ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      {...props}
      className={clsx(
        className,
        'text-content-foreground underline decoration-content-muted-foreground data-hover:decoration-content-foreground'
      )}
    />
  )
}

export function Strong({ className, ...props }: React.ComponentPropsWithoutRef<'strong'>) {
  return <strong {...props} className={clsx(className, 'font-medium text-content-foreground ')} />
}

export function Code({ className, ...props }: React.ComponentPropsWithoutRef<'code'>) {
  return (
    <code
      {...props}
      className={clsx(
        className,
        'rounded-sm border border-content-border bg-content-subtle-background px-0.5 text-sm font-medium text-content-foreground sm:text-[0.8125rem]'
      )}
    />
  )
}
