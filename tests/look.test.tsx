import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { PRESETS } from '../hooks/presets'
import { endedAt } from '../hooks/clock'
import { withoutDelivered, withQueued } from '../hooks/queue'
import { changedRanges, diffLang, sessionCommands, tint } from '../hooks/render'

const t = PRESETS['catppuccin-mocha']
const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const reply = (text: string) => ({ plugin: 'prismantis', surface: 'terminal' as const, component: 'AssistantMessage' as const, props: { text, isFirstOfReply: true }, viewport: { columns: 80, rows: 20 } })
const labels = async (ui: { findAll: (q: { type: string }) => Promise<{ props: { label?: unknown } }[]> }) => (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
const TWO_BLOCKS = 'First paragraph.\n\n```bash\nls\n```'

test('a reply of several blocks gets a copy reply button by default', async $ => {
  const ui = await $.ui.mount(reply(TWO_BLOCKS))
  expect(await labels(ui)).toContain('⧉ copy reply')
  await ui.unmount()
})

test('copyReply off drops the copy reply button and keeps the others', { options: { copyReply: false } }, async $ => {
  const ui = await $.ui.mount(reply(TWO_BLOCKS))
  const found = await labels(ui)
  expect(found).not.toContain('⧉ copy reply')
  expect(found.length).toBeGreaterThan(0)
  await ui.unmount()
})

const marginOf = async (ui: { findAll: (q: { type: string }) => Promise<{ props: { marginTop?: unknown } }[]> }) => (await ui.findAll({ type: 'Box' }))[0]?.props.marginTop

test('replyGap puts a blank line before each part of a reply', { options: { replyGap: true } }, async $ => {
  const ui = await $.ui.mount(reply('One sentence.'))
  expect(await marginOf(ui)).toBe(1)
  await ui.unmount()
})

test('replies keep no gap by default', async $ => {
  const ui = await $.ui.mount(reply('One sentence.'))
  expect(await marginOf(ui)).toBeUndefined()
  await ui.unmount()
})

const SESSION = 'Run:\n\n```console\n$ git status --short\n## main...origin/main\n$ mise run test\nok - cc-keepwarm\n```'

test('codeStyle box draws code blocks inside a rounded border with the language and copy button', { options: { codeStyle: 'box' } }, async $ => {
  const ui = await $.ui.mount(reply('Run:\n\n```python\nprint("hi")\n```'))
  const box = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
  expect(box?.props.borderColor).toBe(t.rule)
  expect(await ui.find({ type: 'Text', text: /^ python$/ })).toBeDefined()
  expect(await ui.find({ type: 'Box', text: /^print\("hi"\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^── python$/ })).toBeUndefined()
  await ui.unmount()
})

test('consoleSplit dims output lines and copies only the commands', { options: { consoleSplit: true } }, async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount(reply(SESSION))
  expect((await ui.find({ type: 'Text', text: /^ok - cc-keepwarm$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^\$ $/ }))?.props.color).toBe(t.accent)
  const button = (await ui.findAll({ type: 'Button' })).find(b => b.props.label !== '⧉ copy reply')
  await ui.press({ key: String(button?.key ?? '') })
  expect(copied).toEqual(['git status --short\nmise run test'])
  await ui.unmount()
})

test('a list puts its copy button beside it, not on a line above', async $ => {
  const ui = await $.ui.mount(reply('Steps:\n\n- Pull upstream\n- Run the checks'))
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row' && b.props.columnGap === 2)
  expect(rows.some(b => /Pull upstream/.test((b as { text?: string }).text ?? ''))).toBe(true)
  await ui.unmount()
})

test('session commands fall back to every line when no line has a prompt', () => {
  expect(sessionCommands(['ls', 'pwd'])).toBe('ls\npwd')
  expect(sessionCommands(['$ ls', 'a.txt', '% pwd'])).toBe('ls\npwd')
})

const prompt = () => ({ plugin: 'prismantis', surface: 'terminal' as const, component: 'UserMessage' as const, props: { text: 'how many frog raids?', origin: { kind: 'composer' } as never, isExpanded: true }, viewport: { columns: 80, rows: 10 } })

test('promptAlign right puts the prompt bubble on the right', { options: { promptAlign: 'right' } }, async $ => {
  const ui = await $.ui.mount(prompt())
  const bubble = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
  expect(bubble?.props.alignSelf).toBe('flex-end')
  await ui.unmount()
})

test('promptAlign right with a bar prompt pushes the row to the right', { options: { promptAlign: 'right', promptStyle: 'bar' } }, async $ => {
  const ui = await $.ui.mount(prompt())
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.justifyContent === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('prompts stay on the left by default', async $ => {
  const ui = await $.ui.mount(prompt())
  const bubble = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
  expect(bubble?.props.alignSelf).toBe('flex-start')
  await ui.unmount()
})

const queuedPrompt = (text: string) => ({ plugin: 'prismantis', surface: 'terminal' as const, component: 'UserMessage' as const, props: { text, origin: { kind: 'composer' } as never, isExpanded: true }, viewport: { columns: 80, rows: 10 } })
const bubbleColor = async (ui: { findAll: (q: { type: string }) => Promise<{ props: { borderStyle?: unknown; borderColor?: unknown } }[]> }) =>
  (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.props.borderColor
const delivery = (text: string) => ({
  message: { type: 'attachment' as const, name: 'queued_command', content: [{ type: 'text' as const, text: `<system-reminder>\nThe user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces messages.\n</system-reminder>` }] },
}) as never

test('dimQueued draws a prompt sent mid-turn in gray until it is delivered', { options: { dimQueued: true } }, async ($, on) => {
  mock.env(on, {})
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'queued test', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  const waiting = await $.ui.mount(queuedPrompt('queued test'))
  expect(await bubbleColor(waiting)).toBe(t.codeComment)
  expect((await waiting.find({ type: 'Text', text: /^queued test$/ }))?.props.color).toBe(t.codeComment)
  await waiting.unmount()
  await $.session.append(delivery('queued test'))
  const read = await $.ui.mount(queuedPrompt('queued test'))
  expect(await bubbleColor(read)).toBe(t.accent)
  await read.unmount()
})

test('dimQueued leaves a prompt sent while idle, or with the option off, in full color', async ($, on) => {
  mock.env(on, {})
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'queued test', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  const ui = await $.ui.mount(queuedPrompt('queued test'))
  expect(await bubbleColor(ui)).toBe(t.accent)
  await ui.unmount()
})

test('a turn line takes no end time older than a minute before it was drawn', () => {
  const ends = [{ durationMs: 5000, at: 1_000 }]
  expect(endedAt(ends, 5000, 61_000)).toBe(1_000)
  expect(endedAt(ends, 5000, 61_001)).toBeUndefined()
})

test('queue helpers drop only the delivered prompt', () => {
  const list = withQueued(withQueued([], 'first  one'), 'second')
  expect(list).toEqual(['first one', 'second'])
  expect(withoutDelivered(list, 'The user sent:\nsecond\n\nmore')).toEqual(['first one'])
  expect(withoutDelivered(list, 'nothing here')).toEqual(list)
})

const local = (h: number, m: number) => new Date(2026, 9, 10, h, m).getTime()
const turnLine = { plugin: 'prismantis', surface: 'terminal' as const, component: 'TurnDuration' as const, props: { word: 'Crunched', durationMs: 5000 } }

test('turnLine claude draws the plain gray line with the clock time on the same line', { options: { turnLine: 'claude', clock: '24h' } }, async ($, on) => {
  engine(on)
  mock.clock(on, { now: local(7, 7) })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount(turnLine)
  expect((await ui.find({ type: 'Text', text: /^✻ Crunched for 5s · 07:07$/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})

test('turnClock off leaves the turn line without a time and keeps the prompt times', { options: { turnLine: 'claude', clock: '24h', turnClock: false } }, async ($, on) => {
  engine(on)
  mock.clock(on, { now: local(7, 7) })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount(turnLine)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /07:07/ })).toBeUndefined()
  await ui.unmount()
})

test('turnLine claude without a time leaves the engine line alone', { options: { turnLine: 'claude' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(turnLine)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /·/ })).toBeUndefined()
  await ui.unmount()
})

const patch = { filePath: '/tmp/app.ts', structuredPatch: [{ oldStart: 4, newStart: 4, lines: [' const a = 1', '-const b = 2', '+const b = 3'] }] }
const edit = { plugin: 'prismantis', surface: 'terminal' as const, component: 'ToolResult' as const, props: { tool_use_id: 'd1', tool: 'Edit', output: patch, isErrored: false } }

test('diffTint vivid tints changed lines over black on a dark theme', { options: { diffTint: 'vivid' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(edit)
  expect((await ui.find({ type: 'Box', text: /^5 \+ const b = 3$/ }))?.props.backgroundColor).toBe(tint('#000000', t.number, 0.3))
  expect((await ui.find({ type: 'Box', text: /^5 - const b = 2$/ }))?.props.backgroundColor).toBe(tint('#000000', t.codeFlag, 0.3))
  await ui.unmount()
})

const row = { plugin: 'prismantis', surface: 'terminal' as const, component: 'ToolUse' as const, props: { tool_use_id: 'r1', tool: 'Read', input: { file_path: '/tmp/app.ts' }, isRunning: false, isErrored: false, isInterrupted: false } }

test('treeMark corner draws a bold long corner in front of tool rows and diff cards', { options: { toolStyle: 'tree-bold', treeMark: 'corner' } }, async ($, on) => {
  engine(on)
  const tool = await $.ui.mount(row)
  expect((await tool.find({ type: 'Text', text: /^ {2}└─ $/ }))?.props.bold).toBe(true)
  expect(await tool.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  await tool.unmount()
  const card = await $.ui.mount(edit)
  expect((await card.find({ type: 'Text', text: /^ {2}└─ $/ }))?.props.bold).toBe(true)
  await card.unmount()
})

test('treeMark keeps the hook mark by default', { options: { toolStyle: 'tree-bold' } }, async ($, on) => {
  engine(on)
  const tool = await $.ui.mount(row)
  expect(await tool.find({ type: 'Text', text: /^ {2}⎿ $/ })).toBeDefined()
  await tool.unmount()
})

test('diffCards off leaves edits to the engine', { options: { diffCards: false } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(edit)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

test('diffTint claude uses Claude Code diff colors and highlights the changed words', { options: { diffTint: 'claude', diffSyntax: true } }, async ($, on) => {
  engine(on)
  const js = { filePath: '/tmp/app.js', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' function greet() {', '-  log("Hello, World!");', '+  log("Hello, Claude!");', ' }'] }] }
  const ui = await $.ui.mount({ ...edit, props: { ...edit.props, output: js } })
  expect((await ui.find({ type: 'Box', text: /^2 \+ {3}log\("Hello, Claude!"\);$/ }))?.props.backgroundColor).toBe('#022800')
  expect((await ui.find({ type: 'Box', text: /^2 - {3}log\("Hello, World!"\);$/ }))?.props.backgroundColor).toBe('#3d0101')
  expect((await ui.find({ type: 'Text', text: /^Claude$/ }))?.props.backgroundColor).toBe('#044700')
  expect((await ui.find({ type: 'Text', text: /^World$/ }))?.props.backgroundColor).toBe('#5c0100')
  expect((await ui.find({ type: 'Text', text: /^function$/ }))?.props.dimColor).toBeUndefined()
  await ui.unmount()
})

test('changed ranges pair removed and added lines and skip lines with nothing in common', () => {
  const row = (mark: '+' | '-' | ' ', text: string) => ({ mark, num: 1, text })
  expect(changedRanges([row('-', 'a = 1'), row('+', 'a = 2'), row(' ', 'b')])).toEqual([[4, 5], [4, 5], undefined])
  expect(changedRanges([row('-', 'abc'), row('+', 'xyz')])).toEqual([undefined, undefined])
  expect(changedRanges([row('+', 'new')])).toEqual([undefined])
})

test('diffBox draws a rounded box around the engine diff', { options: { diffCards: false, diffBox: true } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(edit)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(true)
  await ui.unmount()
})

test('diffSyntax colors diff card code by the file language', { options: { diffSyntax: true } }, async ($, on) => {
  engine(on)
  const py = { filePath: '/tmp/app.py', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+def greet(name):', '+    return "hi"'] }] }
  const ui = await $.ui.mount({ ...edit, props: { ...edit.props, output: py } })
  const def = await ui.find({ type: 'Text', text: /^def$/ })
  expect(def).toBeDefined()
  expect(def?.props.color).not.toBe(t.codeText)
  expect((await ui.find({ type: 'Text', text: /^"hi"$/ }))?.props.color).toBe(t.codeString)
  await ui.unmount()
})

test('diffSyntax leaves a file of unknown language in the plain code color', { options: { diffSyntax: true } }, async ($, on) => {
  engine(on)
  const notes = { filePath: '/tmp/notes.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+def greet'] }] }
  const ui = await $.ui.mount({ ...edit, props: { ...edit.props, output: notes } })
  expect((await ui.find({ type: 'Text', text: /^def greet$/ }))?.props.color).toBe(t.codeText)
  await ui.unmount()
})

test('diff languages come from the file extension', () => {
  expect(diffLang('/a/b/app.py')).toBe('python')
  expect(diffLang('src/x.TSX')).toBe('tsx')
  expect(diffLang('/repo/Dockerfile')).toBe('docker')
  expect(diffLang('README.md')).toBeUndefined()
  expect(diffLang(undefined)).toBeUndefined()
})

test('diffTint vivid tints over white on a light theme', { options: { diffTint: 'vivid', theme: 'catppuccin-latte' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(edit)
  expect((await ui.find({ type: 'Box', text: /^5 \+ const b = 3$/ }))?.props.backgroundColor).toBe(tint('#ffffff', PRESETS['catppuccin-latte'].number, 0.3))
  await ui.unmount()
})
