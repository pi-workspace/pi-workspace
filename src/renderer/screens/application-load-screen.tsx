import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'

type ApplicationLoadScreenProperties = Readonly<{
  title: string
  error?: string
  onRetry?: () => void
}>

export function ApplicationLoadScreen({ title, error, onRetry }: ApplicationLoadScreenProperties) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-page-background px-8 py-12">
      <div className="max-w-md text-center" role={error ? 'alert' : 'status'}>
        {error ? (
          <TriangleAlert aria-hidden="true" className="mx-auto size-7 text-form-error-foreground" />
        ) : (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-7 animate-spin text-content-muted-foreground motion-reduce:animate-none"
          />
        )}
        <h1 className="mt-4 text-lg/7 font-semibold text-content-foreground">{title}</h1>
        {error && <p className="mt-2 text-sm/6 text-content-muted-foreground">{error}</p>}
        {error && onRetry ? (
          <Button className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </main>
  )
}
