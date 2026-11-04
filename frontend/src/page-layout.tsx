import { Group, SimpleGrid, Text, Title } from '@mantine/core';
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Group className="page-header" justify="space-between" align="start">
      <div>
        <Title order={1}>{title}</Title>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </div>
      {children}
    </Group>
  );
}
export function Metrics({
  values,
  loading = false,
}: {
  values: [string, string][];
  loading?: boolean;
}) {
  return (
    <SimpleGrid cols={{ base: 2, md: values.length }} spacing="sm" mb="lg">
      {values.map(([label, value]) => (
        <div className="metric" key={label}>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <strong>{loading ? '—' : value}</strong>
        </div>
      ))}
    </SimpleGrid>
  );
}
