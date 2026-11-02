import { ActionIcon, Group, Popover, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';

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
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={340}
      position="bottom-end"
      withArrow
      shadow="md"
      zIndex={650}
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
        style={{ maxWidth: 'calc(100vw - 32px)', maxHeight: '70dvh', overflowY: 'auto' }}
      >
        <Stack gap="sm">
          <Text fw={700}>{label}</Text>
          <div>
            <Text fw={600} size="sm">
              Wofür eignet es sich?
            </Text>
            <Text size="sm">
              {metadata?.description ||
                'Diese Verbindung liefert für dieses Modell keine Aufgabenbeschreibung.'}
            </Text>
          </div>
          <div>
            <Text fw={600} size="sm">
              Token-Nutzung
            </Text>
            <Text size="sm">
              Token-Verbrauch wird pro Anfrage ermittelt; einen festen Verbrauch pro Modell gibt es
              nicht.
            </Text>
          </div>
          {(metadata?.context_window || metadata?.max_context_tokens) && (
            <Text size="sm">
              Gemeldetes Kontextfenster:{' '}
              {(metadata.context_window || metadata.max_context_tokens)?.toLocaleString('de-DE')}{' '}
              Tokens
            </Text>
          )}
          {metadata?.max_output_tokens && (
            <Text size="sm">
              Gemeldete maximale Ausgabe: {metadata.max_output_tokens.toLocaleString('de-DE')}{' '}
              Tokens
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
            Beschreibung und Grenzen stammen aus der aktuellen Modellantwort des Anbieters. Fehlende
            Angaben werden nicht geschätzt. ChatGPT-Planlimits sind keine garantierten
            Token-Guthaben.
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
