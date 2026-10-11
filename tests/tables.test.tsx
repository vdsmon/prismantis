import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { PRESETS } from '../hooks/presets'
import { captionOf, markdownTable, outputText, tableFooter, tableOf } from '../hooks/tables'

const t = PRESETS['catppuccin-mocha']
const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const PRS = JSON.stringify([
  { number: 67, title: 'cc-rich-rows: draw tables', state: 'MERGED' },
  { number: 66, title: 'cc-timeline: a side pane', state: 'MERGED' },
])
const bash = (stdout: string, extra: Record<string, unknown> = {}) => ({ stdout, stderr: '', interrupted: false, ...extra })
const call = (id: string, command: string, stdout: string, extra: Record<string, unknown> = {}) => ({
  tool_use_id: id,
  tool: 'Bash',
  input: { command },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: bash(stdout),
  ...extra,
})

const result = (output: unknown, opts: { tool?: string; isErrored?: boolean; id?: string } = {}) => ({
  plugin: 'prismantis',
  surface: 'terminal' as const,
  component: 'ToolResult' as const,
  requestId: opts.id ?? 'toolu_r',
  viewport: { columns: 100, rows: 40, isFullscreen: true },
  props: { tool_use_id: opts.id ?? 'toolu_r', tool: opts.tool ?? 'Bash', output, isErrored: opts.isErrored ?? false },
})

const group = (calls: ReturnType<typeof call>[], isExpanded = false) => ({
  plugin: 'prismantis',
  surface: 'terminal' as const,
  component: 'ToolGroup' as const,
  viewport: { columns: 100, rows: 40, isFullscreen: true },
  props: { calls, isActive: false, isExpanded },
})

const footers = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(one => one.text).filter(text => /rows?( ·|$)/.test(text))

test('JSON rows from a shell call draw as a themed table with the row count and run time', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', async () => {
    await clock.sleep(2000)
    return { result: bash(PRS) } as never
  })
  const ran = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_r', command: 'gh pr list --json number,title,state' } as never)
  await clock.advance(2000)
  await ran
  const ui = await $.ui.mount(result(bash(PRS)))
  expect((await ui.find({ type: 'Text', text: /^number$/ }))?.props.color).toBe(t.tableHeader)
  expect(await ui.find({ type: 'Text', text: /^cc-timeline: a side pane$/ })).toBeDefined()
  expect(await footers(ui)).toEqual(['2 rows · 2s'])
  await ui.unmount()
})

test('CSV from an MCP tool draws as a table', async $ => {
  const ui = await $.ui.mount(result([{ type: 'text', text: 'id,name\n1,"Smith, Ann"\n2,Bo\n' }], { tool: 'mcp__db__query' }))
  expect(await ui.find({ type: 'Text', text: /^Smith, Ann$/ })).toBeDefined()
  expect(await footers(ui)).toEqual(['2 rows'])
  await ui.unmount()
})

test('a result row longer than 20 rows, errored, or not a table keeps the engine drawing', async ($, on) => {
  engine(on)
  const many = JSON.stringify(Array.from({ length: 21 }, (_, n) => ({ n })))
  for (const target of [result(bash(many)), result(bash(PRS), { isErrored: true }), result(bash(PRS, { stderr: 'warning' })), result(bash('total 8\nfile a\n'))]) {
    const ui = await $.ui.mount(target)
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a folded group keeps its summary and shows the first 20 rows of a longer table', async $ => {
  const long = JSON.stringify(Array.from({ length: 143 }, (_, n) => ({ n, name: `item ${n}` })))
  const ui = await $.ui.mount(group([call('g1', 'gh issue list --json number,title --limit 200', long)]))
  expect(await ui.find({ type: 'Text', text: /^item 19$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^item 20$/ })).toBeUndefined()
  expect(await footers(ui)).toEqual(['20 of 143 rows · ctrl+o shows all'])
  await ui.unmount()
})

test('a folded group of several calls captions each table with its command', async $ => {
  const ui = await $.ui.mount(group([call('g1', 'git status', 'On branch main\n'), call('g2', 'gh pr list --json number,title,state', PRS), call('g3', 'curl -s api/x', 'id,name\n1,a\n')]))
  expect(await ui.find({ type: 'Text', text: /^\$ gh pr list --json number,title,state$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$ curl -s api\/x$/ })).toBeDefined()
  expect(await footers(ui)).toEqual(['2 rows', '1 row'])
  await ui.unmount()
})

test('an expanded group or a running call draws no table', async ($, on) => {
  engine(on)
  const expanded = await $.ui.mount(group([call('g1', 'gh pr list --json n', PRS)], true))
  expect(await footers(expanded)).toEqual([])
  await expanded.unmount()
  const running = await $.ui.mount(group([call('g2', 'gh pr list --json n', PRS, { isRunning: true })]))
  expect(await footers(running)).toEqual([])
  await running.unmount()
})

test('toolRows off leaves tool output to the engine', { options: { toolRows: false } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result(bash(PRS)))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})

test('toolOutput quiet keeps a folded group to its summary', { options: { toolOutput: 'quiet' } }, async $ => {
  const ui = await $.ui.mount(group([call('g1', 'gh pr list --json number,title,state', PRS)]))
  expect(await footers(ui)).toEqual([])
  await ui.unmount()
})

test('table helpers', () => {
  expect(tableOf('name\tsize\na.ts\t12\nb.ts\t3')).toEqual({ header: ['name', 'size'], rows: [['a.ts', '12'], ['b.ts', '3']] })
  expect(tableOf('[{"a":1},{"b":{"c":true}}]')).toEqual({ header: ['a', 'b'], rows: [['1', ''], ['', '{"c":true}']] })
  expect(tableOf('[1,2,3]')).toBeNull()
  expect(tableOf('Hello, world\nHow are, you')).toBeNull()
  expect(tableOf('64\tfix the build\tOPEN\n63\tdocs\tMERGED')).toBeNull()
  expect(markdownTable({ header: ['a|b'], rows: [['x\ny'], ['z']] }, 1)).toBe('| a\\|b |\n|---|\n| x y |')
  expect(tableFooter(4, 4, 1200)).toBe('4 rows · 1s')
  expect(tableFooter(143, 20)).toBe('20 of 143 rows · ctrl+o shows all')
  expect(captionOf('mcp__db__query', {})).toBe('db query')
  expect(outputText('Bash', bash('out', { returnCodeInterpretation: 'No matches found' }))).toBeNull()
  expect(outputText('mcp__x__y', { content: [{ type: 'text', text: 'a' }, { type: 'image', data: '' }] })).toBeNull()
})
