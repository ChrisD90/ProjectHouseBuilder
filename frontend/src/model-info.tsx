import {
  ActionIcon,
  Badge,
  Box,
  Divider,
  Group,
  Popover,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { getOpenAIModelGuide } from './openai-model-catalog';

const usd = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ModelInfo({
  slug,
  label,
  metadata,
  lastRequest,
}: {
  slug: string;
  label: string;
  metadata?: {
    description?: string;
    context_window?: number;
    max_context_tokens?: number;
    max_output_tokens?: number;
    capabilities?: string[];
  };
  lastRequest?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}) {
  const [opened, setOpened] = useState(false);
  const usage = lastRequest?.model === slug ? lastRequest : null;
  const guide = getOpenAIModelGuide(slug);
  const contextWindow =
    guide?.contextWindow || metadata?.context_window || metadata?.max_context_tokens;
  const maxOutputTokens = guide?.maxOutputTokens || metadata?.max_output_tokens;
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={390}
      position="right-start"
      withArrow
      shadow="md"
      zIndex={650}
      withinPortal
      middlewares={{ flip: true, shift: { padding: 16 } }}
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          style={{ flexShrink: 0, alignSelf: 'center' }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            setOpened((value) => !value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
          }}
          aria-label={'Informationen zum Modell ' + label}
          title="Modellinformationen"
          disabled={!slug}
        >
          <IconInfoCircle size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        p={0}
        style={{
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100dvh - 32px)',
          overflow: 'hidden',
        }}
      >
        <ScrollArea.Autosize
          mah="calc(100dvh - 32px)"
          type="auto"
          scrollbarSize={8}
          overscrollBehavior="contain"
        >
          <Box p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" gap="xs">
                <div>
                  <Text fw={700}>{label}</Text>
                  {guide && (
                    <Text size="xs" c="dimmed">
                      {slug}
                    </Text>
                  )}
                </div>
                {guide && <Badge variant="light">{guide.title}</Badge>}
              </Group>
              <div>
                <Text fw={600} size="sm">
                  Stärken
                </Text>
                <Text size="sm">
                  {guide?.strengths ||
                    metadata?.description ||
                    'Diese Verbindung liefert für dieses Modell keine Aufgabenbeschreibung.'}
                </Text>
              </div>
              {guide && (
                <>
                  <div>
                    <Text fw={600} size="sm">
                      Gut geeignet für
                    </Text>
                    <Text size="sm">{guide.bestFor}</Text>
                  </div>
                  <div>
                    <Text fw={600} size="sm">
                      Grenzen
                    </Text>
                    <Text size="sm">{guide.limitations}</Text>
                  </div>
                  <Divider />
                  <div>
                    <Text fw={600} size="sm">
                      API-Kosten im Standardmodus
                    </Text>
                    <SimpleGrid cols={3} spacing="xs" mt={4}>
                      <div>
                        <Text size="xs" c="dimmed">
                          Eingabe
                        </Text>
                        <Text size="sm" fw={600}>
                          {usd.format(guide.inputUsdPerMillion)}
                        </Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">
                          Ausgabe
                        </Text>
                        <Text size="sm" fw={600}>
                          {usd.format(guide.outputUsdPerMillion)}
                        </Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">
                          Cached
                        </Text>
                        <Text size="sm" fw={600}>
                          {usd.format(guide.cachedInputUsdPerMillion)}
                        </Text>
                      </div>
                    </SimpleGrid>
                    <Text size="xs" c="dimmed" mt={3}>
                      Je 1 Mio. Tokens · Stand {guide.sourceDate}
                    </Text>
                  </div>
                </>
              )}
              <div>
                <Text fw={600} size="sm">
                  Token-Nutzung
                </Text>
                <Text size="sm">
                  Token-Verbrauch wird pro Anfrage ermittelt; einen festen Verbrauch pro Modell gibt
                  es nicht.
                </Text>
              </div>
              {contextWindow && (
                <Text size="sm">
                  Kontextfenster: {contextWindow.toLocaleString('de-DE')} Tokens
                </Text>
              )}
              {maxOutputTokens && (
                <Text size="sm">
                  Maximale Ausgabe: {maxOutputTokens.toLocaleString('de-DE')} Tokens
                </Text>
              )}
              {!!metadata?.capabilities?.length && (
                <Text size="sm">Gemeldete Fähigkeiten: {metadata.capabilities.join(', ')}</Text>
              )}
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
                {guide
                  ? 'Katalogangaben basieren auf der offiziellen OpenAI-Dokumentation. API-Preise sind keine ChatGPT-Abo-Kosten; dort gelten eigene, dynamische Limits.'
                  : 'Beschreibung und Grenzen stammen aus der aktuellen Modellantwort des Anbieters. Fehlende Angaben werden nicht geschätzt. ChatGPT-Planlimits sind keine garantierten Token-Guthaben.'}
              </Text>
            </Stack>
          </Box>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
