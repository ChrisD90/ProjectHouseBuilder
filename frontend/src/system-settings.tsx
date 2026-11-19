import {
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
} from '@mantine/core';
import { IconPalette, IconSparkles } from '@tabler/icons-react';
import { PageHeader } from './page-layout';
import { useDisplaySettings, setDisplaySettings, displayDate, displayMoney } from './presentation';

export function SystemSettings({
  onOpenAI,
  connected,
  sharing,
}: {
  onOpenAI: () => void;
  connected: boolean;
  sharing: boolean;
}) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const settings = useDisplaySettings();
  return (
    <div className="page">
      <PageHeader title="System" description="Darstellung und Verbindungen verwalten." />
      <Stack gap="md" maw={760}>
        <Paper withBorder p="md" data-phb-raw>
          <Stack gap="sm">
            <Title order={3}>Sprache & Formate</Title>
            <Select
              label="Sprache"
              value="de"
              allowDeselect={false}
              data={[{ value: 'de', label: 'Deutsch' }]}
            />
            <Select
              label="Datumsformat"
              value={settings.dateFormat}
              allowDeselect={false}
              data={[
                { value: 'de', label: '31.12.2026' },
                { value: 'iso', label: '2026-12-31' },
                { value: 'slash', label: '31/12/2026' },
              ]}
              onChange={(value) =>
                value && setDisplaySettings({ dateFormat: value as typeof settings.dateFormat })
              }
            />
            <Select
              label="Währungsdarstellung"
              value={settings.currencyDisplay}
              allowDeselect={false}
              data={[
                { value: 'symbol', label: '1.234,56 €' },
                { value: 'code', label: '1.234,56 EUR' },
              ]}
              onChange={(value) =>
                value &&
                setDisplaySettings({ currencyDisplay: value as typeof settings.currencyDisplay })
              }
            />
            <Select
              label="Einheiten"
              value={settings.unitDisplay}
              allowDeselect={false}
              data={[
                { value: 'short', label: 'Kurzzeichen (m², cm, kg)' },
                { value: 'long', label: 'Ausgeschrieben (Quadratmeter, Zentimeter, Kilogramm)' },
              ]}
              onChange={(value) =>
                value && setDisplaySettings({ unitDisplay: value as typeof settings.unitDisplay })
              }
            />
            <Text size="sm">
              Vorschau: {displayDate('2026-12-31')} · {displayMoney(1234.56)}
            </Text>
            <Text size="xs" c="dimmed">
              Anzeige für die gesamte Anwendung in diesem Browser. Beträge und Mengeneinheiten
              werden nicht umgerechnet. Während der Eingabe verwendet der native Datumskalender das
              Browserformat.
            </Text>
          </Stack>
        </Paper>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Group gap="xs">
              <IconPalette size={20} />
              <Title order={3}>Darstellung</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Wähle die Darstellung für diese Anwendung in deinem Browser.
            </Text>
            <Select
              label="Farbschema"
              value={colorScheme}
              allowDeselect={false}
              maw={300}
              data={[
                { value: 'auto', label: 'Systemeinstellung' },
                { value: 'light', label: 'Hell' },
                { value: 'dark', label: 'Dunkel' },
              ]}
              onChange={(value) => {
                if (value === 'auto' || value === 'light' || value === 'dark')
                  setColorScheme(value);
              }}
            />
          </Stack>
        </Paper>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Group gap="xs">
                <IconSparkles size={20} />
                <Title order={3}>ChatGPT</Title>
              </Group>
              <Badge variant="light" color={sharing ? 'green' : connected ? 'yellow' : 'gray'}>
                {sharing ? 'Verbunden' : connected ? 'Freigabe fehlt' : 'Nicht verbunden'}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Verbindung, Modellauswahl und Freigaben einstellen.
            </Text>
            <Group>
              <Button variant="default" onClick={onOpenAI}>
                ChatGPT-Einstellungen öffnen
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Stack>
    </div>
  );
}
