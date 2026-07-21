import { createDemoBridge } from '@/src/demo/demo-bridge'
import { getDemoScenarioPresentation } from '@/src/demo/demo-scenarios'
import { renderApp } from '@/src/renderer/render-app'

const scenarioName = new URLSearchParams(window.location.search).get('scenario') ?? undefined

window.piWorkspace = createDemoBridge(scenarioName)
renderApp({ initialSessionDisplay: getDemoScenarioPresentation(scenarioName) })
