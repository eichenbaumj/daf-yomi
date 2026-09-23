/**
 * One Message Batch round (half price, hours not seconds), resumable: the batch ids for a label are written to
 * .cache/batches/<label>.json, and a rerun with the same label and the same request ids polls those batches instead
 * of paying for them again. Requests are chunked so one submission never nears the API's size limits.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { sleep } from "./cli";

const DIR = ".cache/batches";
const CHUNK = Number(process.env.BATCH_CHUNK ?? 400);
const POLL_MS = 60_000;

export interface BatchRequest { custom_id: string; params: any }
export interface BatchResult<T> { parsed: T | null; usage: { inputTokens: number; outputTokens: number }; error?: string }

interface Saved { ids: string[]; requestIds: string[] }

function hashIds(ids: string[]): string {
  let h = 2166136261;
  for (const s of [...ids].sort()) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}

/** Every finished request's raw result, keyed by a hash of its params, so a rerun that repeats a request never pays for it. */
const RESULTS = `${DIR}/results`;
function hashParams(label: string, r: BatchRequest): string {
  const s = `${label}|${r.custom_id}|${JSON.stringify(r.params)}`;
  let h = 2166136261, g = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h ^= c; h = Math.imul(h, 16777619) >>> 0; g = (Math.imul(g, 33) ^ c) >>> 0; }
  return `${h.toString(16)}${g.toString(16)}`;
}
function cachedResult<T>(key: string): BatchResult<T> | null {
  const p = `${RESULTS}/${key}.json`;
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as BatchResult<T>) : null;
}
function rememberResult(key: string, r: BatchResult<unknown>): void {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/${key}.json`, JSON.stringify(r));
}

export async function runMessageBatch<S extends z.ZodTypeAny>(client: Anthropic, label: string, all: BatchRequest[], schema: S): Promise<Map<string, BatchResult<z.infer<S>>>> {
  const out = new Map<string, BatchResult<z.infer<S>>>();
  if (all.length === 0) return out;
  mkdirSync(DIR, { recursive: true });
  const keys = new Map(all.map((r) => [r.custom_id, hashParams(label, r)]));
  const requests: BatchRequest[] = [];
  for (const r of all) {
    const hit = cachedResult<z.infer<S>>(keys.get(r.custom_id)!);
    if (hit && hit.parsed !== null) out.set(r.custom_id, hit); else requests.push(r);
  }
  if (requests.length < all.length) console.log(`${label}: ${all.length - requests.length} result(s) already on disk; ${requests.length} to submit`);
  if (requests.length === 0) return out;
  const path = `${DIR}/${label}-${hashIds(requests.map((r) => r.custom_id))}.json`;
  let saved: Saved | null = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Saved) : null;
  if (saved) console.log(`${label}: resuming ${saved.ids.length} batch(es) from ${path}`);
  else {
    const ids: string[] = [];
    for (let i = 0; i < requests.length; i += CHUNK) {
      const chunk = requests.slice(i, i + CHUNK);
      const batch = await client.messages.batches.create({ requests: chunk });
      ids.push(batch.id);
      console.log(`${label}: batch ${batch.id} submitted with ${chunk.length} request(s)`);
    }
    saved = { ids, requestIds: requests.map((r) => r.custom_id) };
    writeFileSync(path, JSON.stringify(saved, null, 2));
  }
  // A laptop's network blinks over the hours a batch takes; a failed poll is retried, never fatal.
  const retrieve = async (id: string) => {
    for (let attempt = 1; ; attempt++) {
      try { return await client.messages.batches.retrieve(id); }
      catch (e) { if (attempt >= 30) throw e; process.stdout.write(`  poll failed (${e instanceof Error ? e.message : e}); retrying in ${POLL_MS / 1000}s\n`); await sleep(POLL_MS); }
    }
  };
  for (const id of saved.ids) {
    let status = await retrieve(id);
    while (status.processing_status !== "ended") {
      process.stdout.write(`  ${new Date().toISOString().slice(11, 19)} ${id}: processing ${status.request_counts.processing}, done ${status.request_counts.succeeded}, errored ${status.request_counts.errored}\n`);
      await sleep(POLL_MS);
      status = await retrieve(id);
    }
    for await (const result of await client.messages.batches.results(id)) {
      const cid = result.custom_id;
      const keep = (r: BatchResult<z.infer<S>>) => { out.set(cid, r); const k = keys.get(cid); if (k) rememberResult(k, r); };
      if (result.result.type !== "succeeded") { keep({ parsed: null, usage: { inputTokens: 0, outputTokens: 0 }, error: result.result.type === "errored" ? JSON.stringify(result.result.error) : result.result.type }); continue; }
      const msg = result.result.message;
      const usage = { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
      if (msg.stop_reason === "refusal") { keep({ parsed: null, usage, error: "refused" }); continue; }
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      try { keep({ parsed: schema.parse(JSON.parse(text)), usage }); }
      catch { keep({ parsed: null, usage, error: "unparseable output" }); }
    }
  }
  return out;
}
