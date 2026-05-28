/**
 * coordinator-prompt loader — reads policy file from trusted skills path
 * and provides it for injection as a system message in chat dashboard sessions.
 *
 * Catalisado por drill RED 28/05 (decision DI 2026-05-28-drill-gate-return-
 * fase1-design.md, Camada 1). Chat dashboard cria sessoes e envia user prompt
 * direto ao modelo sem injetar coordinator-prompt como system message — modelo
 * opera sem politica em contexto. Este loader resolve a Camada 1 do redesign
 * gate-return v2: fornece o conteudo do coordinator-prompt para send-stream.ts
 * injetar como system message obrigatorio em todo turn de chat.
 *
 * Path canonical: ~/.hermes/skills/autonomous-ai-agents/tmux-proxy/
 * coordinator-prompt.md (estabelecido na Onda 1 do redesign — trusted skills
 * directory do Hermes skills system).
 *
 * Override: variavel de ambiente HERMES_COORDINATOR_PROMPT_PATH para testes
 * e ambientes alternativos.
 *
 * Cache: in-memory 5min TTL. FS read e ~1ms; cache reduz overhead em sessoes
 * de alta cadencia mas permite hot-update do prompt sem restart.
 *
 * Fallback: ausencia do file -> log warning + retorna empty string. Operacao
 * graceful (chat continua funcionando sem coordinator, equivalente ao estado
 * pre-patch). Princípio 4 (Goal-Driven): goal Camada 1 e "politica presente
 * quando disponivel", nao "fail hard sem politica".
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CACHE_TTL_MS = 5 * 60_000

type CachedPrompt = {
  content: string
  loadedAt: number
}

let cached: CachedPrompt | null = null

function debugEnabled(): boolean {
  return process.env.HERMES_COORDINATOR_DEBUG === '1'
}

function debugLog(msg: string): void {
  if (debugEnabled()) console.log(`[coordinator-prompt-loader] ${msg}`)
}

function resolveCoordinatorPromptPath(): string {
  const override = process.env.HERMES_COORDINATOR_PROMPT_PATH
  if (override && override.trim().length > 0) return override.trim()
  return join(
    homedir(),
    '.hermes',
    'skills',
    'autonomous-ai-agents',
    'tmux-proxy',
    'coordinator-prompt.md',
  )
}

/**
 * Returns coordinator-prompt content as a string. Cached for 5min.
 * Returns empty string if file is missing or unreadable (graceful degradation).
 */
export function loadCoordinatorPrompt(): string {
  const now = Date.now()
  debugLog(`invoked ts=${now} cwd=${process.cwd()}`)

  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    debugLog(
      `cache hit length=${cached.content.length} ageMs=${now - cached.loadedAt}`,
    )
    return cached.content
  }

  const filePath = resolveCoordinatorPromptPath()
  debugLog(`cache miss; resolving path=${filePath}`)

  if (!existsSync(filePath)) {
    console.warn(
      `[coordinator-prompt-loader] file missing at ${filePath}; sessions will run without coordinator policy injected`,
    )
    cached = { content: '', loadedAt: now }
    return ''
  }

  try {
    const content = readFileSync(filePath, 'utf-8').trim()
    debugLog(`fs read OK length=${content.length} path=${filePath}`)
    cached = { content, loadedAt: now }
    return content
  } catch (err) {
    console.warn(
      `[coordinator-prompt-loader] failed to read ${filePath}:`,
      err instanceof Error ? err.message : String(err),
    )
    cached = { content: '', loadedAt: now }
    return ''
  }
}

/**
 * Force cache invalidation. Useful in tests or after file edits during dev.
 */
export function invalidateCoordinatorPromptCache(): void {
  cached = null
}

/**
 * Combine the coordinator-prompt with an optional caller-provided system
 * message (e.g. the `thinking` parameter passed through from the chat
 * dashboard UI).
 *
 * Coordinator goes first so it frames the model's primary policy; caller
 * hints land below as supplemental context. Empty inputs are filtered so
 * callers can pass `undefined` to streamChat instead of injecting a
 * vacuous system_message field.
 */
export function combineSystemMessages(
  coordinator: string,
  additional?: string,
): string {
  const parts = [coordinator, additional].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  )
  if (parts.length === 0) return ''
  return parts.join('\n\n---\n\n')
}
