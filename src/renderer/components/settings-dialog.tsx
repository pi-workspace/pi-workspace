import { useState } from 'react'
import { Palette, X } from 'lucide-react'
import { Button } from '@/components/ui-kit/button'
import { Dialog, DialogBody, DialogDescription, DialogTitle } from '@/components/ui-kit/dialog'
import { Description, Field, Fieldset, Label } from '@/components/ui-kit/fieldset'
import { Radio, RadioField, RadioGroup } from '@/components/ui-kit/radio'
import { getTheme, isThemeId, themes, type AppearancePreference } from '@/src/theme'
import { useTheme } from '@/src/renderer/theme'

type SettingsDialogProperties = Readonly<{
  open: boolean
  onClose(): void
}>

type SettingsSection = 'appearance'

export function SettingsDialog({ open, onClose }: SettingsDialogProperties) {
  const [section, setSection] = useState<SettingsSection>('appearance')
  const { appearance, resolvedColorScheme, theme, setAppearance, setTheme } = useTheme()
  const selectedTheme = getTheme(theme)
  const isDarkOnlyTheme = selectedTheme.colorSchemes.length === 1 && selectedTheme.colorSchemes[0] === 'dark'

  return (
    <Dialog className="p-0!" open={open} onClose={onClose} scrollable size="4xl">
      <div className="grid min-h-136 grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="border-r border-content-border px-3 py-4">
          <div className="px-3 py-2">
            <DialogTitle>Settings</DialogTitle>
          </div>
          <nav aria-label="Settings sections" className="mt-4">
            <button
              type="button"
              aria-current={section === 'appearance' ? 'page' : undefined}
              className="flex w-full items-center gap-2 rounded-md bg-content-interaction px-3 py-2 text-left text-sm/5 font-medium text-content-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              onClick={() => setSection('appearance')}
            >
              <Palette aria-hidden="true" className="size-4" />
              Appearance
            </button>
          </nav>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="flex items-start justify-between gap-6 border-b border-content-border px-8 py-6">
            <div>
              <h2 className="text-xl/7 font-semibold tracking-tight text-content-foreground">Appearance</h2>
              <DialogDescription className="mt-1">Choose how Pi Workspace looks on this device.</DialogDescription>
            </div>
            <Button plain aria-label="Close settings" className="-mt-2 -mr-2 shrink-0 px-3! py-2!" onClick={onClose}>
              <X aria-hidden="true" data-slot="icon" />
            </Button>
          </header>
          <DialogBody className="mt-0! flex-1 px-8 py-7">
            {section === 'appearance' && (
              <Fieldset className="max-w-xl space-y-8">
                <Field>
                  <Label>Theme</Label>
                  <Description>Choose Pi Workspace’s visual language.</Description>
                  <RadioGroup
                    aria-label="Theme"
                    className="mt-4 divide-y divide-content-border overflow-hidden rounded-lg border border-content-border space-y-0!"
                    value={theme}
                    onChange={(value) => {
                      if (isThemeId(value)) void setTheme(value)
                    }}
                  >
                    {themes.map((candidate) => (
                      <RadioField className="px-4 py-3.5" key={candidate.id}>
                        <Radio value={candidate.id} />
                        <Label>{candidate.name}</Label>
                      </RadioField>
                    ))}
                  </RadioGroup>
                </Field>
                <Field>
                  <Label>Color mode</Label>
                  {isDarkOnlyTheme ? (
                    <div className="mt-4 rounded-lg border border-content-border bg-content-subtle-background px-4 py-3.5">
                      <p className="text-sm/5 font-medium text-content-foreground">Dark mode only</p>
                      <Description className="mt-1">
                        {selectedTheme.name} is available in dark mode only. Your color-mode preference will apply again
                        if you select another theme.
                      </Description>
                    </div>
                  ) : (
                    <>
                      <Description>Follow your system preference or choose a fixed mode.</Description>
                      <RadioGroup
                        aria-label="Color mode"
                        className="mt-4 divide-y divide-content-border overflow-hidden rounded-lg border border-content-border space-y-0!"
                        value={appearance}
                        onChange={(value) => {
                          if (value === 'system' || value === 'light' || value === 'dark')
                            void setAppearance(value as AppearancePreference)
                        }}
                      >
                        <RadioField className="px-4 py-3.5">
                          <Radio value="system" />
                          <Label>System</Label>
                          <Description>Currently using {resolvedColorScheme} mode.</Description>
                        </RadioField>
                        <RadioField className="px-4 py-3.5">
                          <Radio value="light" />
                          <Label>Light</Label>
                        </RadioField>
                        <RadioField className="px-4 py-3.5">
                          <Radio value="dark" />
                          <Label>Dark</Label>
                        </RadioField>
                      </RadioGroup>
                    </>
                  )}
                </Field>
              </Fieldset>
            )}
          </DialogBody>
        </div>
      </div>
    </Dialog>
  )
}
