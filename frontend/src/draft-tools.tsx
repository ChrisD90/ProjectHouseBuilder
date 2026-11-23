import { Button, Menu } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, error, success, useConfirm } from './core';
import { displayDateTime } from './presentation';
export function DraftTools<T extends Record<string, unknown>>({
  name,
  value,
  onRestore,
  disabled = false,
}: {
  name: string;
  value: T;
  onRestore: (value: T) => void;
  disabled?: boolean;
}) {
  const ask = useConfirm(),
    path = '/api/ui-drafts/' + encodeURIComponent(name),
    query = useQuery({ queryKey: ['ui-draft', name], queryFn: () => api(path), staleTime: 0 });
  return (
    <Menu withinPortal position="bottom-end">
      <Menu.Target>
        <Button
          size="compact-xs"
          variant="default"
          disabled={disabled}
          aria-label="Formularentwürfe"
        >
          Entwürfe{query.data?.draft ? ' •' : ''}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          disabled={disabled}
          onClick={async () => {
            try {
              await api(path, 'PUT', { value });
              await query.refetch();
              success('Entwurf gesichert.');
            } catch (e) {
              error(e);
            }
          }}
        >
          Aktuelle Eingaben als Entwurf sichern
        </Menu.Item>
        {query.data?.draft && (
          <>
            <Menu.Label>Gesichert: {displayDateTime(query.data.draft.saved_at)}</Menu.Label>
            <Menu.Item
              disabled={disabled}
              onClick={async () => {
                if (
                  await ask(
                    'Gesicherten Entwurf in dieses Formular laden? Aktuelle Eingaben werden ersetzt. Es wird noch nichts fachlich gespeichert oder gebucht.',
                  )
                )
                  onRestore(query.data!.draft.value as T);
              }}
            >
              Gesicherten Entwurf fortsetzen
            </Menu.Item>
            <Menu.Item
              color="red"
              disabled={disabled}
              onClick={async () => {
                if (await ask('Gesicherten Formularentwurf löschen?'))
                  try {
                    await api(path, 'DELETE');
                    await query.refetch();
                  } catch (e) {
                    error(e);
                  }
              }}
            >
              Gesicherten Entwurf löschen
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
