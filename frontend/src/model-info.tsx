import { ActionIcon, Group, Popover, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

export function modelGuidance(slug: string) {
  const value = slug.toLowerCase();
  if (/codex/.test(value))
    return {
      tasks:
        'Vor allem für Programmierung, Codeanalyse und technische Fehlersuche. Für Bauvorhaben ist meist ein allgemeines Modell passender.',
      tokens:
        'Bei umfangreichem Code und längeren Analysen können große Ein- und Ausgaben entstehen.',
    };
  if (/thinking|reasoning|^o[134](?:-|$)|pro(?:-|$)/.test(value))
    return {
      tasks:
        'Für anspruchsvolle Planung, das Vergleichen mehrerer Varianten und komplexe Zusammenhänge.',
      tokens:
        'Modelle mit vertieftem Nachdenken können zusätzliche Reasoning-Tokens nutzen. Für einfache Listen ist dieser Aufwand oft nicht nötig.',
    };
  if (/mini|nano/.test(value))
    return {
      tasks:
        'Für kurze Fragen, einfache Listen, Zusammenfassungen und erste Entwürfe. Komplexe Berechnungen und Fachdetails besonders sorgfältig prüfen.',
      tokens:
        'Kleine Modellvarianten sind häufig für schnelle, ressourcensparende Aufgaben ausgelegt. Eine geringere Token-Anzahl pro Antwort ist damit nicht garantiert.',
    };
  if (/gpt/.test(value))
    return {
      tasks:
        'Für allgemeine Fragen, Material- und Werkzeuglisten, Dokumentauswertung und das gemeinsame Erarbeiten eines Vorgehens.',
      tokens:
        'Der Verbrauch hängt vor allem von Eingabelänge, Gesprächsverlauf und Antwortumfang ab. Lange Dokumente und ausführliche Antworten benötigen mehr Tokens.',
    };
  return {
    tasks:
      'Für dieses Modell liegt keine gesicherte Aufgabenbeschreibung vor. Beachte die Angaben des Anbieters und prüfe die Ergebnisse an deinem Vorhaben.',
    tokens: 'Eine belastbare Verbrauchseinschätzung für dieses Modell ist nicht verfügbar.',
  };
}

export function ModelInfo({
  slug,
  label,
  lastRequest,
}: {
  slug: string;
  label: string;
  lastRequest?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}) {
  const info = modelGuidance(slug),
    usage = lastRequest?.model === slug ? lastRequest : null;
  return (
    <Popover width={340} position="bottom-end" withArrow shadow="md" zIndex={650} trapFocus>
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          aria-label={'Informationen zum Modell ' + label}
          title="Modellinformationen"
          disabled={!slug}
        >
          <IconInfoCircle size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown style={{ maxWidth: 'calc(100vw - 32px)' }}>
        <Stack gap="sm">
          <Text fw={700}>{label}</Text>
          <div>
            <Text fw={600} size="sm">
              Wofür eignet es sich?
            </Text>
            <Text size="sm">{info.tasks}</Text>
          </div>
          <div>
            <Text fw={600} size="sm">
              Token-Nutzung
            </Text>
            <Text size="sm">{info.tokens}</Text>
          </div>
          {usage ? (
            <div>
              <Text size="sm" fw={600}>
                Letzte gemeldete Anfrage dieses Modells
              </Text>
              <Group gap="xs">
                <Text size="sm">Eingabe: {usage.input_tokens ?? 'nicht gemeldet'}</Text>
                <Text size="sm">Ausgabe: {usage.output_tokens ?? 'nicht gemeldet'}</Text>
              </Group>
              <Text size="sm">Gesamt: {usage.total_tokens ?? 'nicht gemeldet'} Tokens</Text>
            </div>
          ) : (
            <Text size="sm" c="dimmed">
              Für dieses Modell wurde noch kein Token-Verbrauch gemeldet.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Aufgabenhinweise sind eine allgemeine Einordnung nach Modellfamilie. Ein fester
            Token-Verbrauch oder verbleibendes Modellkontingent lässt sich daraus nicht ableiten.
            ChatGPT-Planlimits sind keine garantierten Token-Guthaben.
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
