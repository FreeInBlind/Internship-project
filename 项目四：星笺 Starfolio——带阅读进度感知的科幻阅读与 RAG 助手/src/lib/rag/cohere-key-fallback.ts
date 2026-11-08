export type CohereKeyState = { trialExhausted: boolean };

export async function requestWithCohereKey(input: {
  trialKey?: string;
  productionKey?: string;
  state: CohereKeyState;
  request: (key: string) => Promise<Response>;
}) {
  const trialKey = input.trialKey?.trim();
  const productionKey = input.productionKey?.trim();
  if (!trialKey || input.state.trialExhausted) {
    if (!productionKey) throw new Error('Cohere production key is not configured');
    return input.request(productionKey);
  }

  const response = await input.request(trialKey);
  if (response.status !== 402) return response;
  let message: unknown;
  try {
    const body = await response.clone().json();
    message = body.message ?? body.error?.message;
  } catch {
    return response;
  }
  if (typeof message !== 'string' || !/(?:reached|exceeded|exhausted).{0,100}billing\s+limit|billing\s+limit.{0,100}(?:reached|exceeded|exhausted)/i.test(message)) return response;

  input.state.trialExhausted = true;
  if (!productionKey) return response;
  await response.body?.cancel();
  return input.request(productionKey);
}
