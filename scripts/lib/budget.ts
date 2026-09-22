/** KV writes made by scripts today (UTC), so a re-bake stops before the free plan's 1,000 writes/day (cron ~35). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PATH = ".cache/kv-writes.json";
export interface WriteLog { date: string; count: number }

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export function loadWriteLog(now = new Date()): WriteLog {
  const day = utcDay(now);
  if (!existsSync(PATH)) return { date: day, count: 0 };
  const log = JSON.parse(readFileSync(PATH, "utf8")) as WriteLog;
  return log.date === day ? log : { date: day, count: 0 };
}

export function saveWriteLog(log: WriteLog): void {
  mkdirSync(".cache", { recursive: true });
  writeFileSync(PATH, JSON.stringify(log));
}

/** Pure: may one more write happen under `budget` today? A day rolls the count over. */
export function canWrite(log: WriteLog, budget: number, now = new Date()): boolean {
  return (log.date === utcDay(now) ? log.count : 0) < budget;
}
