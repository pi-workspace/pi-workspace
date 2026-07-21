import { code } from '@streamdown/code'
import { useMemo, type ReactNode } from 'react'
import { Streamdown, type Components } from 'streamdown'
import { isAllowedExternalUrl } from '@/src/session-transcript'

const markdownPlugins = { code }

type MarkdownMessageProperties = Readonly<{
  source: string
  streaming: boolean
  onOpenExternalLink: (url: string) => void
}>

export function MarkdownMessage({ source, streaming, onOpenExternalLink }: MarkdownMessageProperties) {
  const components = useMemo<Components>(
    () => ({
      a: ({ children, href }) =>
        isAllowedExternalUrl(href) ? (
          <button
            type="button"
            className="cursor-pointer break-all text-session-message-link-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={() => onOpenExternalLink(href)}
          >
            {children}
          </button>
        ) : (
          <span>{children}</span>
        ),
      blockquote: MarkdownBlockquote,
      h1: MarkdownHeadingOne,
      h2: MarkdownHeadingTwo,
      h3: MarkdownHeadingThree,
      h4: MarkdownHeadingFour,
      h5: MarkdownHeadingFive,
      h6: MarkdownHeadingSix,
      hr: MarkdownRule,
      img: MarkdownImage,
      li: MarkdownListItem,
      ol: MarkdownOrderedList,
      p: MarkdownParagraph,
      strong: MarkdownStrong,
      ul: MarkdownUnorderedList,
    }),
    [onOpenExternalLink]
  )

  return (
    <Streamdown
      className="min-w-0 break-words"
      components={components}
      controls={{ code: { copy: true } }}
      isAnimating={streaming}
      linkSafety={{ enabled: false }}
      mode="streaming"
      plugins={markdownPlugins}
      rehypePlugins={[]}
      remarkPlugins={[]}
      skipHtml
    >
      {source}
    </Streamdown>
  )
}

function MarkdownParagraph({ children }: Readonly<{ children?: ReactNode }>) {
  return <p className="break-words">{children}</p>
}

function MarkdownHeadingOne({ children }: Readonly<{ children?: ReactNode }>) {
  return <h1 className="text-lg/7 font-semibold">{children}</h1>
}

function MarkdownHeadingTwo({ children }: Readonly<{ children?: ReactNode }>) {
  return <h2 className="text-base/6 font-semibold">{children}</h2>
}

function MarkdownHeadingThree({ children }: Readonly<{ children?: ReactNode }>) {
  return <h3 className="font-semibold">{children}</h3>
}

function MarkdownHeadingFour({ children }: Readonly<{ children?: ReactNode }>) {
  return <h4 className="font-medium">{children}</h4>
}

function MarkdownHeadingFive({ children }: Readonly<{ children?: ReactNode }>) {
  return <h5 className="font-medium">{children}</h5>
}

function MarkdownHeadingSix({ children }: Readonly<{ children?: ReactNode }>) {
  return <h6 className="font-medium">{children}</h6>
}

function MarkdownStrong({ children }: Readonly<{ children?: ReactNode }>) {
  return <strong className="font-semibold">{children}</strong>
}

function MarkdownUnorderedList({ children }: Readonly<{ children?: ReactNode }>) {
  return <ul className="list-disc space-y-1 pl-5">{children}</ul>
}

function MarkdownOrderedList({ children }: Readonly<{ children?: ReactNode }>) {
  return <ol className="list-decimal space-y-1 pl-5">{children}</ol>
}

function MarkdownListItem({ children }: Readonly<{ children?: ReactNode }>) {
  return <li className="break-words pl-1">{children}</li>
}

function MarkdownBlockquote({ children }: Readonly<{ children?: ReactNode }>) {
  return <blockquote className="border-l-2 border-session-message-code-border pl-3">{children}</blockquote>
}

function MarkdownRule() {
  return <hr className="border-session-message-code-border" />
}

function MarkdownImage({ alt }: Readonly<{ alt?: string }>) {
  return alt ? <span>{alt}</span> : null
}
