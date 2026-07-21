// Renderer tests preload one browser-like environment before importing components.
// Lexical must initialize before its React adapters to avoid circular ESM binding errors in Bun.
import 'lexical'
import { Window } from 'happy-dom'

export const browser = new Window({ url: 'http://localhost' })

Object.assign(browser.Element.prototype, {
  getAnimations: () => [],
})

Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
  ClipboardEvent: browser.ClipboardEvent,
  DataTransfer: browser.DataTransfer,
  DOMParser: browser.DOMParser,
  InputEvent: browser.InputEvent,
  KeyboardEvent: browser.KeyboardEvent,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver,
  Node: browser.Node,
  NodeFilter: browser.NodeFilter,
  Range: browser.Range,
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  getComputedStyle: browser.getComputedStyle.bind(browser),
})
