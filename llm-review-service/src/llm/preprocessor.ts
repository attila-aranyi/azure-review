import { z } from "zod";
import type { LLMClient } from "./types";
import { preprocessorSystemPrompt, buildPreprocessorPrompt } from "./prompts/preprocessorPrompt";

export type ContextCandidate = {
  id: string;
  source: "local" | "candidate";
  text: string;
};

export type PreprocessorInput = {
  hunkText: string;
  localContext: string;
  candidates: ContextCandidate[];
  tokenBudget: number;
};

export const preprocessorOutputSchema = z.object({
  selected: z.array(
    z.object({
      id: z.string().min(1),
      source: z.enum(["local", "candidate"]),
      reason: z.string().min(1),
      text: z.string().min(1)
    })
  ).optional()
}).transform((value) => ({ selected: value.selected ?? [] }));

export type PreprocessorOutput = z.infer<typeof preprocessorOutputSchema>;

export async function runPreprocessor(args: {
  client: LLMClient;
  input: PreprocessorInput;
  timeoutMs: number;
}): Promise<PreprocessorOutput> {
  const prompt = buildPreprocessorPrompt({
    tokenBudget: args.input.tokenBudget,
    hunkText: args.input.hunkText,
    localContext: args.input.localContext,
    candidates: args.input.candidates
  });

  const output = await args.client.completeJSON({
    stage: "llm1",
    system: preprocessorSystemPrompt,
    prompt,
    schema: preprocessorOutputSchema,
    timeoutMs: args.timeoutMs
  });

  if (args.input.candidates.length === 0) {
    const hasLocal = output.selected.some((s) => s.source === "local");
    if (!hasLocal) {
      output.selected.unshift({
        id: "local",
        source: "local",
        reason: "No candidates provided; include local context",
        text: args.input.localContext
      });
    }
  }

  return output;
}
