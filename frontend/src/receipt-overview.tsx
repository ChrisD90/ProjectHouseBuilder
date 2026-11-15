import { Badge, Button, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Editor, money } from './core';
import { projectID } from './project-context';

export type OverviewReceipt = {
  id: number;
  number: string;
  supplier: string;
  date: string;
  status: string;
  billing_type: string;
  kind: string;
  gross: number;
  amount: number;
  paid: number;
  source_amount?: number;
};
export type ReceiptOverviewData = {
  title: string;
  receipts: OverviewReceipt[];
  summary?: [string, number][];
  emptyText: string;
  sourceLabel?: string;
  editMode?: 'financing';
};

export function ReceiptOverview({
  title,
  receipts,
  summary,
  emptyText,
  sourceLabel,
  editMode,
  onClose,
  footer,
}: ReceiptOverviewData & { onClose: () => void; footer?: ReactNode }) {
  return (
    <Editor opened title={title} onClose={onClose} zIndex={300} size={1120}>
      <Stack>
        <Text size="sm" c="dimmed">
          {receipts.length}{' '}
          {editMode === 'financing'
            ? 'Belege mit offener Finanzierungszuordnung'
            : 'zugeordnete Belege'}
        </Text>
        {!!summary?.length && (
          <SimpleGrid cols={{ base: 2, sm: summary.length }}>
            {summary.map(([label, value]) => (
              <div key={label}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text fw={600} size="sm">
                  {money(value)}
                </Text>
              </div>
            ))}
          </SimpleGrid>
        )}
        {receipts.length ? (
          <Table.ScrollContainer minWidth={sourceLabel ? 830 : 700}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  {[
                    'Beleg',
                    'Status / Art',
                    'Brutto',
                    'Angerechnet',
                    'Bezahlt',
                    ...(sourceLabel ? [sourceLabel] : []),
                    'Aktionen',
                  ].map((label) => (
                    <Table.Th key={label}>{label}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {receipts.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {r.number}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {r.supplier} · {r.date || 'Ohne Datum'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={
                          r.status === 'Gebucht'
                            ? 'green'
                            : r.status === 'Storniert'
                              ? 'red'
                              : 'gray'
                        }
                      >
                        {r.status}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {r.kind || 'Rechnung'}
                        {r.kind !== 'Kassenzettel' && r.billing_type && r.billing_type !== 'Normal'
                          ? ' · ' + r.billing_type
                          : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>{money(r.gross)}</Table.Td>
                    <Table.Td>{money(r.status === 'Gebucht' ? r.amount : 0)}</Table.Td>
                    <Table.Td>{money(r.paid)}</Table.Td>
                    {sourceLabel && <Table.Td>{money(r.source_amount || 0)}</Table.Td>}
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          component="a"
                          href={'/api/receipts/' + r.id + '/preview?project_id=' + projectID}
                          target="_blank"
                          rel="noopener"
                          variant="subtle"
                          size="xs"
                        >
                          Original ansehen
                        </Button>
                        <Button
                          component={Link}
                          to={
                            '/belege?receipt_id=' +
                            r.id +
                            (editMode === 'financing' ? '&financing=1' : '')
                          }
                          onClick={onClose}
                          variant="subtle"
                          size="xs"
                        >
                          {editMode === 'financing' ? 'Finanzierung zuordnen' : 'Bearbeiten'}
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            {emptyText}
          </Text>
        )}
        {footer && <Group justify="flex-end">{footer}</Group>}
      </Stack>
    </Editor>
  );
}
