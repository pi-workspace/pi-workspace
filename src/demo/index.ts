import { createDemoBridge } from '@/src/demo/demo-bridge'
import { getDemoScenarioPresentation } from '@/src/demo/demo-scenarios'
import { renderApp } from '@/src/renderer/render-app'

const searchParameters = new URLSearchParams(window.location.search)
const scenarioName = searchParameters.get('scenario') ?? undefined
const applicationUpdateStateName = searchParameters.get('update') ?? undefined

window.piWorkspace = createDemoBridge(scenarioName, applicationUpdateStateName)
renderApp({ initialSessionDisplay: getDemoScenarioPresentation(scenarioName) })
