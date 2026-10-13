// Dollar price per 1M tokens, used only when GTWY doesn't report a call's cost. Keyed by service/model.
// Source: OpenAI API pricing page, Standard tier, short context, checked 2026-10-13.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'openai/gpt-6-luna': { input: 0.10, output: 0.50 },
};

export function priceOf(model: string, input?: number | null, output?: number | null): number | null {
  const p = MODEL_PRICES[model];
  return p ? ((input ?? 0) * p.input + (output ?? 0) * p.output) / 1e6 : null;
}
