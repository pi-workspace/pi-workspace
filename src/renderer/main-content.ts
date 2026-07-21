export type MainContentState = Readonly<{
  destination: 'startup' | 'changelog'
}>

export type MainContentAction = Readonly<{
  type: 'return-to-startup' | 'open-changelog' | 'activate-session'
}>

export const initialMainContentState: MainContentState = {
  destination: 'startup',
}

export function updateMainContent(state: MainContentState, action: MainContentAction): MainContentState {
  switch (action.type) {
    case 'open-changelog':
      return { destination: 'changelog' }
    case 'activate-session':
    case 'return-to-startup':
      return { ...state, destination: 'startup' }
  }
}
