import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'

type WorkstreamsLoadScreenProperties = Readonly<{
  error?: string
  onRetry?: () => void
}>

export function WorkstreamsLoadScreen({ error, onRetry }: WorkstreamsLoadScreenProperties) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-content-background px-8 py-12">
      <div className="max-w-md text-center" role={error ? 'alert' : 'status'}>
        {error ? (
          <TriangleAlert aria-hidden="true" className="mx-auto size-6 text-form-error-foreground" />
        ) : (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-6 animate-spin text-content-muted-foreground motion-reduce:animate-none"
          />
        )}
        <h1 className="mt-4 text-base/6 font-semibold text-content-foreground">
          {error ? 'Could not load Workstreams' : 'Loading Workstreams'}
        </h1>
        {error && <p className="mt-2 text-sm/6 text-content-muted-foreground">{error}</p>}
        {error && onRetry ? (
          <Button className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  )
}
