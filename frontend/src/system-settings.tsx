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
  return (
    <div className="page">
      <PageHeader title="System" description="Darstellung und Verbindungen verwalten." />
      <Stack gap="md" maw={760}>
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
