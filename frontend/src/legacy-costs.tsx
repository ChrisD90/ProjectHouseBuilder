import { Alert, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, Editor, ErrorBox, money, Row, useConfirm } from './core';

export function LegacyCosts({ selected, onClose }: { selected: Row; onClose: () => void }) {
  const [target, setTarget] = useState<Row | null>(selected.id ? selected : null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const ask = useConfirm(),
    cache = useQueryClient();
  const path = target
    ? '/api/' + (target.kind === 'line' ? 'budget/lines' : 'costs') + '/' + target.id + '/cleanup'
    : '';
  const list = useQuery({
    queryKey: ['legacy-costs'],
    queryFn: () => api('/api/cost-dashboard/legacy'),
  });
  const detail = useQuery({
    queryKey: ['legacy-cost', path],
    queryFn: () => api(path),
    enabled: !!path,
    staleTime: 0,
  });
  async function change(ref?: Row) {
    if (busy) return;
    if (
      !(await ask(
        ref
          ? 'Nur die Zuordnung „' +
              ref.label +
              '“ zu dieser alten Planposition lösen? Der Datensatz und seine Zahlungen bleiben erhalten. Die Projektprognose kann sich ändern.'
          : '„' +
              detail.data?.title +
              '“ endgültig löschen? Die alte Planungssumme entfällt. Dieser Schritt kann nur über ein Backup rückgängig gemacht werden.',
      ))
    )
      return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        path,
        ref ? 'POST' : 'DELETE',
        ref ? { table: ref.table, id: ref.id, field: ref.field } : undefined,
      );
      await cache.invalidateQueries({ queryKey: ['cost-dashboard'] });
      await cache.invalidateQueries({ queryKey: ['projects'] });
      await cache.invalidateQueries({ queryKey: ['legacy-costs'] });
      if (ref) await detail.refetch();
      else {
        setTarget(null);
        onClose();
      }
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Editor opened title="Alte Kostenplanung bereinigen" onClose={onClose} busy={busy}>
      <Stack>
        <Alert>
          Hier findest du frühere Kostenplanpositionen und manuelle Kostenpositionen ohne Angebot.
          Lösche nur Einträge, die du nicht mehr benötigst. Verknüpfte Originale und Zahlungen
          werden nicht gelöscht.
        </Alert>
        <ErrorBox value={failure || detail.error || list.error} />
        {target ? (
          <>
            <Button
              variant="subtle"
              disabled={busy}
              onClick={() => {
                setTarget(null);
                setFailure(null);
              }}
            >
              Alle alten Positionen anzeigen
            </Button>
            {detail.isPending ? (
              <Loader />
            ) : (
              detail.data && (
                <>
                  <Text fw={600}>{detail.data.title}</Text>
                  <Text>Planwert: {money(detail.data.amount)}</Text>
                  {(detail.data.references || []).map((ref: Row) => (
                    <Paper withBorder p="sm" key={ref.table + ':' + ref.id + ':' + ref.field}>
                      <Group justify="space-between">
                        <Text size="sm">{ref.label}</Text>
                        <Button
                          size="xs"
                          variant="light"
                          disabled={busy || !ref.detachable}
                          onClick={() => void change(ref)}
                        >
                          Zuordnung lösen
                        </Button>
                      </Group>
                      {!ref.detachable && (
                        <Text size="xs" c="dimmed">
                          Diese Abhängigkeit muss im zugehörigen Fachbereich bearbeitet werden.
                        </Text>
                      )}
                    </Paper>
                  ))}
                  {detail.data.blocked_reason && (
                    <Alert color="yellow">{detail.data.blocked_reason}</Alert>
                  )}
                  {detail.data.can_delete && (
                    <Text size="sm">Keine Verknüpfungen mehr vorhanden.</Text>
                  )}
                  <Group justify="flex-end">
                    <Button
                      color="red"
                      disabled={busy || !detail.data.can_delete}
                      onClick={() => void change()}
                    >
                      Position löschen
                    </Button>
                  </Group>
                </>
              )
            )}
          </>
        ) : (
          <>
            {list.isPending && <Loader />}
            {(list.data?.rows || []).map((r: Row) => (
              <Paper withBorder p="sm" key={r.kind + ':' + r.id}>
                <Group justify="space-between">
                  <div>
                    <Text size="sm" fw={600}>
                      {r.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {r.kind === 'line' ? 'Kostenplan' : 'Manuelle Kostenposition'}
                      {r.group ? ' · Gruppe' : ''}
                      {!r.active ? ' · Inaktiv' : ''} · {money(r.amount)}
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => {
                      setTarget(r);
                      setFailure(null);
                    }}
                  >
                    Prüfen
                  </Button>
                </Group>
              </Paper>
            ))}
            {!list.isPending && !list.data?.rows?.length && (
              <Text>Keine alten Positionen vorhanden.</Text>
            )}
          </>
        )}
      </Stack>
    </Editor>
  );
}
