import { projectID } from './project-context';
import React, { createContext, useContext, useRef, useState } from 'react';
import { Modal, Button, Group, Text, TextInput, Stack, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
export type Row = Record<string, any>;
let writes = 0;
export async function api<T = Row>(
  path: string,
  method = 'GET',
  body?: unknown,
  ai = false,
): Promise<T> {
  const form = body instanceof FormData;
  const headers: Record<string, string> = { 'X-PHB-Project': String(projectID) };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (ai) headers['X-PHB-AI'] = '1';
  const mutation = !['GET', 'HEAD'].includes(method);
  if (mutation) writes++;
  try {
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    if (r.status === 401) {
      location.assign('/login');
      throw Error('Bitte erneut anmelden.');
    }
    const data = await r.json();
    if (!r.ok) throw Error(data.error || 'Anfrage fehlgeschlagen.');
    return data;
  } finally {
    if (mutation) writes--;
  }
}
export const hasWrites = () => writes > 0;
export const money = (n: unknown) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
export const error = (e: unknown) =>
  notifications.show({
    color: 'red',
    title: 'Aktion fehlgeschlagen',
    message: e instanceof Error ? e.message : String(e),
    autoClose: false,
  });
export const success = (message: string) => notifications.show({ color: 'teal', message });
type Question = {
  message: string;
  title?: string;
  initial?: string;
  cancel?: boolean;
  confirmLabel?: string;
};
const ConfirmVisibleContext = createContext(false);
const ModalLayerContext = createContext({ blocked: false, setExternal: (_value: boolean) => {} });
export const useModalLayer = () => useContext(ModalLayerContext);
export const useConfirmVisible = () => useContext(ConfirmVisibleContext);
const ConfirmContext = createContext<(q: Question | string) => Promise<string | boolean>>(() =>
  Promise.resolve(false),
);
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [external, setExternal] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null),
    [text, setText] = useState('');
  const resolve = useRef<(v: string | boolean) => void>(() => {});
  const ask = (q: Question | string) =>
    new Promise<string | boolean>((done) => {
      const next = typeof q === 'string' ? { message: q } : q;
      setText(next.initial || '');
      resolve.current = done;
      setQuestion(next);
    });
  const finish = (value: string | boolean) => {
    setQuestion(null);
    resolve.current(value);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      <ConfirmVisibleContext.Provider value={!!question}>
        <ModalLayerContext.Provider value={{ blocked: !!question || external, setExternal }}>
          {children}
          <Modal
            zIndex={500}
            opened={!!question}
            onClose={() => finish(false)}
            title={question?.title || 'Bitte bestätigen'}
            closeOnClickOutside={false}
            centered
          >
            <Stack>
              <Text size="sm">{question?.message}</Text>
              {question?.initial !== undefined && (
                <TextInput autoFocus value={text} onChange={(e) => setText(e.target.value)} />
              )}
              <Group justify="flex-end">
                {question?.cancel !== false && (
                  <Button variant="default" onClick={() => finish(false)}>
                    Abbrechen
                  </Button>
                )}
                <Button onClick={() => finish(question?.initial !== undefined ? text : true)}>
                  {question?.confirmLabel || (question?.cancel === false ? 'OK' : 'Bestätigen')}
                </Button>
              </Group>
            </Stack>
          </Modal>
        </ModalLayerContext.Provider>
      </ConfirmVisibleContext.Provider>
    </ConfirmContext.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmContext);
export const EditorCoveredContext = createContext(false);
export function Editor({
  opened,
  title,
  dirty,
  busy,
  onClose,
  children,
  zIndex,
  suspended,
}: {
  opened: boolean;
  title: string;
  dirty?: boolean;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  zIndex?: number;
  suspended?: boolean;
}) {
  const ask = useConfirm(),
    confirming = useModalLayer().blocked,
    covered = useContext(EditorCoveredContext) || suspended;
  return (
    <Modal
      trapFocus={!confirming && !covered}
      zIndex={zIndex}
      opened={opened}
      onClose={async () => {
        if (!busy && (!dirty || (await ask('Ungespeicherte Änderungen verwerfen?')))) onClose();
      }}
      title={title}
      closeOnClickOutside={false}
      closeOnEscape={!busy && !confirming && !covered}
      withCloseButton
      closeButtonProps={{ 'aria-label': 'Schließen', disabled: busy || covered }}
      size="lg"
      centered
    >
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {children}
      </fieldset>
    </Modal>
  );
}
export function ErrorBox({ value }: { value: unknown }) {
  return value ? (
    <Alert color="red">{value instanceof Error ? value.message : String(value)}</Alert>
  ) : null;
}
