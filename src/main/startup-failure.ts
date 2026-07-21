export const startupRetryUrl = 'pi-workspace-retry:'

export function createStartupFailureUrl(kind: 'initialization' | 'renderer-load'): string {
  const title = kind === 'initialization' ? 'Pi Workspace could not start' : 'Pi Workspace could not open its window'
  const guidance =
    kind === 'initialization'
      ? 'Your saved Workspaces and Sessions are unaffected. Restart Pi Workspace to try initialization again.'
      : 'Your saved Workspaces and Sessions are unaffected. Restart Pi Workspace to load the window again.'
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; background: Canvas; color: CanvasText; }
body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
main { max-width: 30rem; padding: 3rem; text-align: center; }
h1 { font-size: 1.25rem; line-height: 1.75rem; margin: 0; }
p { color: GrayText; font-size: .875rem; line-height: 1.5rem; }
a { display: inline-block; margin-top: .75rem; border: 1px solid ButtonBorder; border-radius: .5rem; padding: .6rem .9rem; color: ButtonText; background: ButtonFace; text-decoration: none; }
a:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
</style>
</head>
<body><main role="alert"><h1>${title}</h1><p>${guidance}</p><a href="${startupRetryUrl}">Restart Pi Workspace</a></main></body>
</html>`

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
