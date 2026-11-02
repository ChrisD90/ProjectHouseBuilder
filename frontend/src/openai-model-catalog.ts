export type OpenAIModelGuide = {
  title: string;
  strengths: string;
  limitations: string;
  bestFor: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  contextWindow: number;
  maxOutputTokens: number;
  sourceDate: string;
};

// OpenAI Standard API pricing and model guidance, checked on 2026-11-02.
// Keep this catalogue explicit: GET /models does not guarantee descriptions or prices.
const OPENAI_MODEL_GUIDES: Record<string, OpenAIModelGuide> = {
  'gpt-6-astra': {
    title: 'Maximale Qualität',
    strengths: 'OpenAIs leistungsfähigstes Modell für komplexes Schlussfolgern und Programmierung.',
    limitations:
      'Deutlich teurer als die übrigen Modelle und für einfache Routineaufgaben meist unnötig.',
    bestFor:
      'Schwierige Förderanalysen, widersprüchliche Dokumente und anspruchsvolle Projektplanung.',
    inputUsdPerMillion: 10,
    outputUsdPerMillion: 50,
    cachedInputUsdPerMillion: 1,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    sourceDate: '02.11.2026',
  },
  'gpt-6.1-sol': {
    title: 'Empfohlener Allrounder',
    strengths: 'Nahe an Astra bei komplexen Aufgaben, aber wesentlich günstiger.',
    limitations: 'Für einfache Extraktionen teurer und aufwendiger als Luna.',
    bestFor: 'Planung, Recherche, Förderungen und anspruchsvolle Dokumentanalysen.',
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 0.1,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    sourceDate: '02.11.2026',
  },
  'gpt-6.1-terra': {
    title: 'Dokumente & Bilder',
    strengths:
      'Schnell und effizient bei visueller Analyse, Computerbedienung und natürlichem Schreiben.',
    limitations: 'Bei sehr komplexen Abhängigkeiten und Planungen schwächer als Sol oder Astra.',
    bestFor: 'Rechnungen, Angebote, PDFs, Bilder und visuelle Dokumentprüfung.',
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.05,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    sourceDate: '02.11.2026',
  },
  'gpt-6-luna': {
    title: 'Schnell & günstig',
    strengths: 'Sehr niedrige Kosten und hohe Geschwindigkeit bei klar begrenzten Routineaufgaben.',
    limitations:
      'Weniger zuverlässig bei komplexen Regeln, langen Schlussfolgerungen und unklaren Fällen.',
    bestFor:
      'Klassifikation, Zusammenfassungen, einfache Extraktion und Vorschläge in großer Menge.',
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.5,
    cachedInputUsdPerMillion: 0.01,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    sourceDate: '02.11.2026',
  },
};

export function getOpenAIModelGuide(slug: string): OpenAIModelGuide | undefined {
  return OPENAI_MODEL_GUIDES[slug.toLowerCase()];
}
