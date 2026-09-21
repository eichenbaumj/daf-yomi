import styleGuide from "../../prompts/daf-note.md";
import { z } from "zod";

/** Bumped by hand when the house style changes in a way that should re-bake the archive. */
export const PROMPT_VERSION = "2026-09-21.8";

export const NoteSchema = z.object({
  summary: z.string().describe("Three plain sentences, about 80 words, never past 90."),
  question: z.string().describe("One sentence ending in a question mark."),
  quotes: z.array(z.string()).max(2).describe("0-2 phrases of 12 words or fewer copied exactly from the English text."),
});
export type NoteDraft = z.infer<typeof NoteSchema>;

export const SYSTEM_PROMPT = styleGuide.trim();

export interface PromptInput {
  label: string; // "Bekhorot 2"
  positionLine: string; // "Seder Kodashim · Bekhorot · Chapter 1 of 9 · Daf 2 of 61"
  sections: { label: string; text: string }[]; // plain English text per amud
  feedback?: string; // on retry: what failed
}

export function userMessage(input: PromptInput): string {
  const body = input.sections.map((s) => `### ${s.label}\n\n${s.text}`).join("\n\n");
  const parts = [
    `Today's page: ${input.label}. Position: ${input.positionLine}.`,
    `Below is the complete English text of the page (bold in the original marks the Talmud's own words; the rest is the translator's explanation, rendered here as plain text). It is your only source.`,
    body,
    `Write the note for ${input.label} following the house style. Return only the structured fields.`,
  ];
  if (input.feedback) parts.push(`Your previous attempt was rejected: ${input.feedback} Fix that and try again.`);
  return parts.join("\n\n");
}

export function hashPrompt(): string {
  // Cheap stable fingerprint of the style guide so a wording change is visible in stored notes.
  let h = 2166136261;
  for (let i = 0; i < SYSTEM_PROMPT.length; i++) { h ^= SYSTEM_PROMPT.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${PROMPT_VERSION}-${h.toString(16)}`;
}
