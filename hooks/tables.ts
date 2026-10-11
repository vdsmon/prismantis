import { formatDuration } from './render'

export type Table = { header: string[]; rows: string[][] }

export const MAX_ROWS = 20
export const PREVIEW_ROWS = 20
const MAX_COLUMNS = 10
const MAX_TEXT = 1_000_000
const SCALAR_WIDTH = 60

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const isTabular = (tool: string) => tool === 'Bash' || tool.startsWith('mcp__')

export const outputText = (tool: string, output: unknown): string | null => {
  if (tool === 'Bash') {
    if (!isRecord(output) || typeof output.stdout !== 'string') return null
    const hasExtras =
      (typeof output.stderr === 'string' && output.stderr.trim() !== '') ||
      output.interrupted === true ||
      output.isImage === true ||
      output.backgroundTaskId !== undefined ||
      output.returnCodeInterpretation !== undefined ||
      output.persistedOutputPath !== undefined ||
      output.timedOutAfterMs !== undefined
    return hasExtras ? null : output.stdout
  }
  if (!tool.startsWith('mcp__')) return null
  if (typeof output === 'string') return output
  const blocks = Array.isArray(output) ? output : isRecord(output) && Array.isArray(output.content) ? output.content : null
  if (blocks === null || blocks.length === 0) return null
  const texts = blocks.map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : null))
  return texts.every(text => text !== null) ? texts.join('\n') : null
}

const cellOf = (value: unknown): string | null => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return json.length <= SCALAR_WIDTH ? json : null
}

const fromJson = (text: string): Table | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isRecord)) return null
  const header = [...new Set(parsed.flatMap(row => Object.keys(row)))]
  if (header.length === 0 || header.length > MAX_COLUMNS) return null
  const rows: string[][] = []
  for (const row of parsed) {
    const cells = header.map(key => cellOf(row[key]))
    if (cells.some(cell => cell === null)) return null
    rows.push(cells as string[])
  }
  return { header, rows }
}

const csvFields = (line: string): string[] | null => {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      fields.push(field)
      field = ''
    } else field += ch
  }
  if (quoted) return null
  fields.push(field)
  return fields
}

const isHeader = (cells: readonly string[]) =>
  cells.every(cell => /^[A-Za-z][\w .\-/()#%]{0,31}$/.test(cell.trim())) && new Set(cells.map(cell => cell.trim().toLowerCase())).size === cells.length

const fromDelimited = (text: string): Table | null => {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()
  if (lines.length < 2) return null
  const delimiter = lines[0]?.includes('\t') ? '\t' : ','
  if (delimiter === ',' && lines[0]?.includes(', ')) return null
  const parsed = lines.map(line => (delimiter === '\t' ? line.split('\t') : csvFields(line)))
  const width = parsed[0]?.length ?? 0
  if (width < 2 || width > MAX_COLUMNS || parsed.some(fields => fields === null || fields.length !== width)) return null
  const [header, ...rows] = parsed as string[][]
  if (header === undefined || !isHeader(header)) return null
  return { header: header.map(cell => cell.trim()), rows: rows.map(row => row.map(cell => cell.trim())) }
}

export const tableOf = (text: string): Table | null => {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > MAX_TEXT) return null
  return trimmed.startsWith('[') ? fromJson(trimmed) : fromDelimited(trimmed)
}

export const toolTable = (tool: string, output: unknown): Table | null => {
  if (!isTabular(tool)) return null
  const text = outputText(tool, output)
  return text === null ? null : tableOf(text)
}

const escape = (cell: string) => cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

export const markdownTable = (table: Table, rows = table.rows.length): string => {
  const line = (cells: readonly string[]) => `| ${cells.map(escape).join(' | ')} |`
  return [line(table.header), `|${table.header.map(() => '---').join('|')}|`, ...table.rows.slice(0, rows).map(line)].join('\n')
}

export const tableFooter = (total: number, shown: number, ms?: number): string => {
  const rows = `${total} row${total === 1 ? '' : 's'}`
  return [shown < total ? `${shown} of ${rows}` : rows, ...(ms === undefined ? [] : [formatDuration(ms)]), ...(shown < total ? ['ctrl+o shows all'] : [])].join(' · ')
}

export const captionOf = (tool: string, input: unknown): string => {
  if (tool === 'Bash') return `$ ${(isRecord(input) && typeof input.command === 'string' ? input.command : '').split('\n')[0] ?? ''}`
  return tool.split('__').slice(1).join(' ')
}
