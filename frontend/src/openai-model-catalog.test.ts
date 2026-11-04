import { describe, expect, it } from 'vitest';
import { getOpenAIModelGuide } from './openai-model-catalog';

describe('OpenAI model catalogue', () => {
  it('provides distinct guidance and prices for the current core models', () => {
    const astra = getOpenAIModelGuide('gpt-6-astra');
    const sol = getOpenAIModelGuide('gpt-6.1-sol');
    const terra = getOpenAIModelGuide('gpt-6.1-terra');
    const luna = getOpenAIModelGuide('gpt-6-luna');

    expect([astra, sol, terra, luna].every(Boolean)).toBe(true);
    expect(
      new Set([astra?.strengths, sol?.strengths, terra?.strengths, luna?.strengths]).size,
    ).toBe(4);
    expect(astra?.outputUsdPerMillion).toBe(50);
    expect(sol?.outputUsdPerMillion).toBe(10);
    expect(terra?.outputUsdPerMillion).toBe(5);
    expect(luna?.outputUsdPerMillion).toBe(0.5);
  });

  it('leaves unknown provider models to the metadata fallback', () => {
    expect(getOpenAIModelGuide('future-model')).toBeUndefined();
  });
});
