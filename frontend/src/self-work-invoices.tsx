import { Badge, Button, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { Editor, money } from './core';
import { projectID } from './project-context';
import type { Plan } from './self-work-types';

export function SelfWorkInvoices({
  plan,
  onClose,
  onCreate,
}: {
  plan: Plan;
  onClose: () => void;
  onCreate: () => void;
}) {
  const paid = plan.receipts
    .filter((r) => r.status === 'Gebucht')
    .reduce((sum, r) => sum + r.paid, 0);
  return (
    <Editor opened title={'Rechnungen · ' + plan.title} onClose={onClose}>
      <Stack>
        <Text size="sm" c="dimmed">
          {plan.receipts.length} zugeordnete Belege
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          {[
            ['Planwert', plan.estimated_cost],
            ['Gebucht', plan.actual_cost],
            ['Bezahlt', paid],
            ['Rest', Math.max(plan.estimated_cost, plan.actual_cost) - paid],
          ].map(([label, value]) => (
            <div key={label}>
              <Text size="xs" c="dimmed">
                {label}
              </Text>
              <Text fw={600} size="sm">
                {money(Number(value))}
              </Text>
            </div>
          ))}
        </SimpleGrid>
        {plan.receipts.length ? (
          <Table.ScrollContainer minWidth={700}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  {['Beleg', 'Status / Art', 'Brutto', 'Angerechnet', 'Bezahlt', 'Aktionen'].map(
                    (x) => (
                      <Table.Th key={x}>{x}</Table.Th>
                    ),
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {plan.receipts.map((r) => (
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
                        {r.billing_type || r.kind}
                      </Text>
                    </Table.Td>
                    <Table.Td>{money(r.gross)}</Table.Td>
                    <Table.Td>{money(r.status === 'Gebucht' ? r.amount : 0)}</Table.Td>
                    <Table.Td>{money(r.paid)}</Table.Td>
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
                          to={'/belege?receipt_id=' + r.id}
                          onClick={onClose}
                          variant="subtle"
                          size="xs"
                        >
                          Bearbeiten
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
            Dieser Eigenleistung sind noch keine Rechnungen zugeordnet.
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={onCreate}>Neue Rechnung zuordnen</Button>
        </Group>
      </Stack>
    </Editor>
  );
}
