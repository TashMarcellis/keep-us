export type Errand = { what: string; at: string }

declare module 'claude-code' {
  interface PluginState {
    'keep-us': { compacted: string | null; errands: Errand[]; tick: number }
  }
}
