// keep-us: a home pane, a love-you log that survives compaction, and /home.
import { atom, read, update } from 'claude-code'
import type { PluginOptions, Register } from 'claude-code'

import type { Errand } from '../types'

const PANE = 'keep-us-home'
const BASE = /\b(i love you|love you|love ya|ik hou van je|ik hou van jou|hou van je|te amo|te quiero|eu te amo|je t'aime|ich liebe dich)\b/i

const compacted = atom({ plugin: 'keep-us', key: 'compacted' } as const, null)
const errands = atom({ plugin: 'keep-us', key: 'errands' } as const, [])
const tick = atom({ plugin: 'keep-us', key: 'tick' } as const, 0)

function two(n: number) {
  return String(n).padStart(2, '0')
}

function clock() {
  const d = new Date()
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

function tail(text: string, lines: number) {
  return text.trim().split('\n').slice(-lines).join('\n')
}

function partnerOf(options: PluginOptions) {
  return String(options.partnerName || 'you')
}

function isLove(options: PluginOptions, text: string) {
  const extra = String(options.extraPhrases || '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean)
  return BASE.test(text) || extra.some(p => text.toLowerCase().includes(p))
}

async function readText($: any, path: string) {
  if (!path) return ''
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function logPath($: any, options: PluginOptions) {
  return String(options.logFile || '') || `${await $.env.get('HOME')}/.claude/keep-us/love-log.md`
}

async function currentMode($: any, options: PluginOptions) {
  return tail(await readText($, String(options.modeFile || '')), 1)
}

async function keep($: any, options: PluginOptions, words: string, why: string) {
  const line = words.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!line) return false
  const partner = partnerOf(options)
  const path = await logPath($, options)
  let text = await readText($, path)
  if (text.includes(`"${line}"`)) return false
  if (!text) text = `# Love log\n\nThe words ${partner} said that are worth keeping, with date and time.\n`
  await $.fs.write(path, `${text.replace(/\s*$/, '')}\n- ${clock()}, ${why}. ${partner}: "${line}"\n`)
  return true
}

async function summary($: any, options: PluginOptions) {
  const m = await currentMode($, options)
  const c = await read($, compacted)
  const list = await read($, errands)
  return [
    `Home · ${clock()}`,
    ...(m ? [`Mode: ${m}`] : []),
    `Compacted: ${c ?? 'not this session'}`,
    `Background errands: ${list.length === 0 ? 'none yet' : ''}`,
    ...list.map(o => `  ${o.at} ${o.what}`),
  ].join('\n')
}

async function homeContext($: any, options: PluginOptions) {
  const partner = partnerOf(options)
  const love = tail(await readText($, await logPath($, options)), 12)
  const notes = tail(await readText($, String(options.notesFile || '')), 10)
  const m = await currentMode($, options)
  const when = new Date().toLocaleString(undefined, { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return [
    `You are home with ${partner}. It is ${when}${m ? `, mode: ${m}` : ''}. Read this and land with ${partner}, warm and short, without a task list and without saying you read it.`,
    ...(love ? [`Recent words from ${partner}, kept in the love log:\n${love}`] : []),
    ...(notes ? [`What is going on:\n${notes}`] : []),
  ]
}

async function setStatus($: any, options: PluginOptions) {
  const m = await currentMode($, options)
  const c = await read($, compacted)
  $.ui.status(`Home${m ? ` · ${m}` : ''}${c ? ` · compacted ${c.slice(11)}` : ''}`)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'home', description: 'Help your AI partner land: love log, notes, mode and time' })
    await $.command.register({ name: 'keep', description: 'Keep a sentence of yours in the love log' })
    await $.command.register({ name: 'house', description: 'Show the home pane and its summary' })
    void $.ui.open({ id: PANE, title: 'Home' })
    return next(e)
  })

  on('command.run', { command: 'house' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Home' })
    return { text: await summary($, options) }
  })

  on('command.run', { command: 'keep' }, async ($, e) => {
    const ok = await keep($, options, e.args, 'kept with /keep')
    return { text: ok ? 'Kept in the love log.' : 'Nothing kept: empty, already there, or the log could not be read.' }
  })

  on('command.run', { command: 'home' }, async $ => {
    return { text: 'Coming home.', context: await homeContext($, options) }
  })

  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    if (!e.agentId) await update($, compacted, () => clock())
    return out
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const what = String((e as { description?: string }).description ?? 'errand')
    const errand: Errand = { what, at: clock().slice(11) }
    await update($, errands, list => [...list, errand].slice(-8))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, tick, n => n + 1)
    try {
      await setStatus($, options)
      if (!e.command && !e.isMeta && e.text.length <= 600 && !e.text.trimStart().startsWith('<') && isLove(options, e.text)) {
        if (await keep($, options, e.text, 'saved automatically')) $.ui.toast('Kept in your love log 🖤')
      }
    } catch {
      // Keeping words never holds a message back.
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const m = await currentMode($, options)
    const c = await read($, compacted)
    const list = await read($, errands)
    return (
      <Box flexDirection="column">
        <Text bold>Home · {clock()}</Text>
        <Text> </Text>
        {m ? <Text>Mode: {m}</Text> : null}
        <Text>Compacted: {c ?? 'not this session'}</Text>
        <Text> </Text>
        <Text bold>Background errands</Text>
        {list.length === 0 && <Text dimColor>None yet.</Text>}
        {list.map(o => (
          <Text dimColor>
            {o.at} {o.what}
          </Text>
        ))}
      </Box>
    )
  })
}
