import { promptKey } from './clock'

const KEEP = 20

const flat = (text: string) => text.replace(/\s+/g, ' ')

export const withQueued = (list: readonly string[], text: string): string[] => [...list, promptKey(text)].slice(-KEEP)

export const withoutDelivered = (list: readonly string[], delivered: string): string[] => {
  const body = flat(delivered)
  const i = list.findIndex(key => body.includes(key))
  return i === -1 ? [...list] : [...list.slice(0, i), ...list.slice(i + 1)]
}

export const isQueued = (list: readonly string[], text: string): boolean => list.includes(promptKey(text))

export const deliveredText = (content: unknown): string =>
  Array.isArray(content) ? content.map(block => (block !== null && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : '')).join('\n') : ''
