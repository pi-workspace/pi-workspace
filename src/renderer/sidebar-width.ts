export const minimumSidebarWidth = 240
export const maximumSidebarWidth = 480

export function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, minimumSidebarWidth), maximumSidebarWidth)
}

export function adjustSidebarWidth(width: number, amount: number): number {
  return clampSidebarWidth(width + amount)
}
