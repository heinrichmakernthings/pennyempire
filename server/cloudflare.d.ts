// Minimal ambient types so the Worker entry type-checks without @cloudflare/workers-types.
declare module 'cloudflare:workers' {
  export class DurableObject<E = unknown> { ctx: DurableObjectState; env: E; constructor(ctx: DurableObjectState, env: E); }
}
interface DurableObjectState { storage: { setAlarm(ms: number): Promise<void> }; blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> }
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }
