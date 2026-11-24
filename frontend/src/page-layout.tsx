import { SimpleGrid, Text, Title } from '@mantine/core';
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
    <header className="page-header">
      <div>
        <Title order={1}>{title}</Title>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
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
