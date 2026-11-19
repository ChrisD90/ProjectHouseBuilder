import { NumberInput, Select, SimpleGrid, Stack, Text, Anchor } from '@mantine/core';
import { OsbConfig, TileSettings } from './tile-layout';
import { osbSources } from './osb-layout';
import { TileHeading } from './tile-info';
export function OsbFields({
  settings,
  onChange,
}: {
  settings: TileSettings;
  onChange: (value: TileSettings) => void;
}) {
  const config = settings.osb!;
  const update = (patch: Partial<OsbConfig>) =>
    onChange({
      ...settings,
      osb: { ...config, ...patch },
      ...(patch.profile ? { joint: patch.profile === 'tg' ? 0 : 3 } : {}),
    });
  const numeric = (
    key: keyof Omit<OsbConfig, 'profile' | 'installation'>,
    label: string,
    min: number,
    max: number,
  ) => (
    <NumberInput
      size="sm"
      label={label}
      min={min}
      max={max}
      decimalSeparator=","
      hideControls
      value={Number.isFinite(config[key]) ? config[key] : ''}
      onChange={(value) => update({ [key]: typeof value === 'number' ? value : NaN })}
    />
  );
  return (
    <Stack gap="xs">
      <Select
        label="Bodenaufbau"
        allowDeselect={false}
        value={config.installation}
        data={[
          { value: 'floating', label: 'Durchgehend unterstützt / schwimmend' },
          { value: 'joists', label: 'Tragend auf Balkenlage' },
        ]}
        onChange={(value) => value && update({ installation: value as OsbConfig['installation'] })}
      />
      <Select
        label="Plattenkante"
        allowDeselect={false}
        value={config.profile}
        data={[
          { value: 'tg', label: 'Nut/Feder mit integrierter Fuge' },
          { value: 'square', label: 'Geradkantig · Herstellerfuge' },
        ]}
        onChange={(value) => value && update({ profile: value as OsbConfig['profile'] })}
      />
      <SimpleGrid cols={2}>
        {numeric('thickness', 'Dicke (mm)', 6, 60)}
        {numeric('minStagger', 'Mindestversatz (mm)', 100, 2500)}
      </SimpleGrid>
      {config.installation === 'joists' && (
        <SimpleGrid cols={2}>
          {numeric('joistSpacing', 'Achsraster (mm)', 100, 2000)}
          {numeric('joistWidth', 'Balkenbreite (mm)', 40, 200)}
          {numeric(
            'joistOffset',
            settings.rotated ? 'Erste Achse Y (mm)' : 'Erste Achse X (mm)',
            0,
            2000,
          )}
        </SimpleGrid>
      )}
    </Stack>
  );
}
export function OsbNotes({ notes }: { notes: string[] }) {
  return (
    <Stack gap="xs">
      <TileHeading
        title="OSB · Planungsgrundlagen"
        warning={notes.some((note) => note.includes('nicht aufgelagert'))}
        info={notes.join('\n\n')}
      />
      <Text size="xs" c="dimmed">
        EGGER-Nut/Feder-Planungsprofil · Mindestversatz anpassbar nach Produktvorgabe · keine
        statische Bemessung.
      </Text>
      {osbSources.map((source) => (
        <Anchor
          size="xs"
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {source.title}
        </Anchor>
      ))}
    </Stack>
  );
}
