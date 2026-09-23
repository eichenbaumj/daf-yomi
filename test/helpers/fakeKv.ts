/** Enough of KVNamespace for the stores and the bakes: values plus metadata, `stream` and `arrayBuffer` reads. */
export class FakeKV {
  store = new Map<string, { value: Uint8Array | string; metadata?: unknown }>();
  writes = 0;
  /** Throw this on the next put, to play the free plan's "KV put() limit exceeded for the day". */
  failNextPut: Error | null = null;
  async get(key: string, type?: string) {
    const v = this.store.get(key);
    if (!v) return null;
    const text = typeof v.value === "string" ? v.value : new TextDecoder().decode(v.value);
    return type === "json" ? JSON.parse(text) : text;
  }
  async getWithMetadata(key: string, type?: string) {
    const v = this.store.get(key);
    if (!v) return { value: null, metadata: null };
    const bytes = typeof v.value === "string" ? new TextEncoder().encode(v.value) : v.value;
    if (type === "arrayBuffer") return { value: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: v.metadata ?? null };
    let cancelled = false;
    return { value: { cancel: async () => { cancelled = true; }, get cancelled() { return cancelled; } }, metadata: v.metadata ?? null };
  }
  async put(key: string, value: string | Uint8Array | ArrayBuffer, opts?: { metadata?: unknown }) {
    if (this.failNextPut) { const e = this.failNextPut; this.failNextPut = null; throw e; }
    this.writes++;
    this.store.set(key, { value: value instanceof ArrayBuffer ? new Uint8Array(value) : value, metadata: opts?.metadata });
  }
  async list(opts?: { prefix?: string }) {
    const keys = [...this.store.entries()].filter(([name]) => !opts?.prefix || name.startsWith(opts.prefix)).map(([name, v]) => ({ name, metadata: v.metadata }));
    return { keys, list_complete: true as const, cursor: undefined };
  }
}
