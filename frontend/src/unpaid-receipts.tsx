import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, type Row } from './core';
import { projectID } from './project-context';

function localDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Ohne Datum';
  const [year, month, day] = value.split('-').map(Number);
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const locale = languages.find((language) => /^de(?:-|$)/i.test(language)) || languages;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function UnpaidReceipts() {
  const [opened, setOpened] = useState(false),
    navigate = useNavigate();
  const query = useQuery({
    queryKey: ['unpaid-receipts', projectID],
    queryFn: () => api('/api/receipts'),
    staleTime: 15000,
    refetchInterval: 30000,
  });
  const rows: Row[] = (query.data?.receipts || [])
    .filter(
      (row: Row) =>
        row.status === 'Gebucht' &&
        (row.kind || 'Rechnung') === 'Rechnung' &&
        Math.round(Number(row.counted_amount || 0) * 100) >
          Math.round(Number(row.paid_amount || 0) * 100),
    )
    .sort(
      (a: Row, b: Row) =>
        String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || a.id - b.id,
    );
  if (!rows.length && !opened) return null;
  return (
    <>
      {!!rows.length && (
        <Tooltip label={'Offene Rechnungen: ' + rows.length}>
          <ActionIcon
            variant="default"
            size={36}
            className="header-unpaid-button"
            aria-label={'Offene Rechnungen: ' + rows.length}
            aria-haspopup="dialog"
            onClick={() => {
              setOpened(true);
              void query.refetch();
            }}
          >
            <IconInfoCircle size={19} />
            <span className="header-unpaid-count">{rows.length}</span>
          </ActionIcon>
        </Tooltip>
      )}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Offene Rechnungen"
        size="lg"
        centered
        closeOnClickOutside={false}
        closeButtonProps={{ 'aria-label': 'Schließen' }}
      >
        <ScrollArea.Autosize mah="70dvh">
          <Stack gap="sm">
            {!rows.length && <Text c="dimmed">Alle Rechnungen sind bezahlt.</Text>}
            {rows.map((row) => (
              <Paper withBorder p="md" key={row.id}>
                <Group justify="space-between" align="start" wrap="nowrap">
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Text size="sm" fw={600}>
                      {row.supplier || row.filename}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[row.invoice_number, localDate(row.document_date)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {row.due_date && (
                      <Text size="xs" c="dimmed">
                        Zahlungsziel: {localDate(row.due_date)}
                      </Text>
                    )}
                    <Text size="sm" mt={6}>
                      Offen:{' '}
                      <strong>
                        {money(
                          Math.max(
                            0,
                            Math.round(Number(row.counted_amount) * 100) -
                              Math.round(Number(row.paid_amount || 0) * 100),
                          ) / 100,
                        )}
                      </strong>
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    style={{ flexShrink: 0 }}
                    aria-label={
                      'Rechnung ' +
                      (row.invoice_number || row.supplier || row.filename) +
                      ' bezahlen'
                    }
                    onClick={() => {
                      setOpened(false);
                      navigate('/belege?receipt_id=' + row.id + '&financing=1');
                    }}
                  >
                    Bezahlen
                  </Button>
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Modal>
    </>
  );
}
