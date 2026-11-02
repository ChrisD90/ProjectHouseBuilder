import {
  Alert,
  Button,
  Checkbox,
  Group,
  List,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api, Editor, ErrorBox, money } from './core';
import { ActionBar } from './ui';
import { useDirtyGuard } from './shell';
import type { PlanningContext, Proposal } from './self-work-types';

type Message = { role: 'user' | 'assistant'; content: string };
type Reply = { answer: string; questions: string[]; ready: boolean; token: string };
export function SelfWorkAI({
  opened,
  context,
  model,
  onClose,
  onApply,
}: {
  opened: boolean;
  context: PlanningContext;
  model: string;
  onClose: () => void;
  onApply: (proposal: Proposal) => Promise<void>;
}) {
  const [history, setHistory] = useState<Message[]>([]),
    [message, setMessage] = useState(''),
    [reply, setReply] = useState<Reply | null>(null),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [consent, setConsent] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const pending = useRef(false);
  const dirty = history.length > 0 || message !== (context.description || context.title);
  useDirtyGuard(opened && dirty);
  useEffect(() => {
    if (opened) {
      setHistory([]);
      setMessage(context.description || context.title);
      setReply(null);
      setProposal(null);
      setConsent(false);
      setReady(false);
      setFailure(null);
    }
  }, [opened]);
  async function run(generate = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    const conversation: Message[] = generate
      ? history
      : [...history, { role: 'user', content: message.trim() }];
    try {
      const body = {
        context,
        history: conversation,
        consent,
        plan_only: true,
        model,
        ...(generate ? { token: reply?.token, user_ready: ready } : {}),
      };
      if (generate) {
        const result = await api<{ proposal: Proposal }>(
          '/api/self-work/ai/plan',
          'POST',
          body,
          true,
        );
        setProposal(result.proposal);
      } else {
        const result = await api<Reply>('/api/self-work/ai/consult', 'POST', body, true);
        setHistory([
          ...conversation,
          {
            role: 'assistant',
            content:
              result.answer + (result.questions.length ? '\n' + result.questions.join('\n') : ''),
          },
        ]);
        setReply(result);
        setMessage('');
        setReady(false);
      }
    } catch (error) {
      setFailure(error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Editor
      opened={opened}
      title="Eigenleistung mit ChatGPT planen"
      busy={busy}
      dirty={dirty}
      onClose={onClose}
      zIndex={260}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {context.title} · {context.experience}. ChatGPT klärt zuerst offene Fragen. Du
          entscheidest anschließend, ob der Plan erstellt wird.
        </Text>
        <Alert variant="light" color="teal">
          Der Vorschlag ist eine Orientierung. Mengen, Ausführung und Annahmen vor der Verwendung
          prüfen; unbekannte Preise bleiben offen.
        </Alert>
        {!proposal ? (
          <>
            {history.length > 0 && (
              <details>
                <summary>Bisheriges Gespräch ({history.length / 2} Runden)</summary>
                <Stack gap="sm" mt="sm">
                  {history.map((item, index) => (
                    <Paper key={index} withBorder p="sm">
                      <Text size="xs" fw={700}>
                        {item.role === 'user' ? 'Du' : 'ChatGPT'}
                      </Text>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {item.content}
                      </Text>
                    </Paper>
                  ))}
                </Stack>
              </details>
            )}
            {reply && (
              <Paper withBorder p="md">
                <Text style={{ whiteSpace: 'pre-wrap' }}>{reply.answer}</Text>
                {reply.questions.length > 0 && (
                  <List mt="sm">
                    {reply.questions.map((question) => (
                      <List.Item key={question}>{question}</List.Item>
                    ))}
                  </List>
                )}
              </Paper>
            )}
            <Textarea
              label={reply ? 'Deine Antwort oder Ergänzung' : 'Was möchtest du selbst machen?'}
              description="Zum Beispiel Maße, Untergrund, gewünschtes Ergebnis und vorhandene Werkzeuge."
              value={message}
              onChange={(event) => {
                setMessage(event.currentTarget.value);
                setReady(false);
              }}
              autosize
              minRows={3}
              maxRows={8}
              maxLength={4000}
            />
            <Checkbox
              label="Ich möchte die Vorhabensangaben und diesen Gesprächsverlauf an ChatGPT übermitteln."
              checked={consent}
              onChange={(event) => setConsent(event.currentTarget.checked)}
            />
            {reply?.ready && (
              <Checkbox
                label="Die Angaben reichen mir für einen Planvorschlag."
                checked={ready}
                onChange={(event) => setReady(event.currentTarget.checked)}
              />
            )}
            {reply && !reply.ready && (
              <Text size="sm" c="dimmed">
                Beantworte die offenen Fragen, damit ChatGPT einen passenden Ablauf vorschlagen
                kann.
              </Text>
            )}
            <ErrorBox value={failure} />
            <ActionBar>
              <Button
                variant={reply?.ready ? 'default' : 'filled'}
                disabled={!consent || !message.trim() || history.length >= 16}
                loading={busy}
                onClick={() => void run()}
              >
                {reply ? 'Antwort senden' : 'Vorhaben besprechen'}
              </Button>
              {reply?.ready && (
                <Button
                  leftSection={<IconSparkles size={17} />}
                  disabled={!consent || !ready || !!message.trim()}
                  loading={busy}
                  onClick={() => void run(true)}
                >
                  Planvorschlag erstellen
                </Button>
              )}
            </ActionBar>
          </>
        ) : (
          <>
            <Title order={3}>Dein Planvorschlag</Title>
            <Text>{proposal.summary}</Text>
            {proposal.assumptions.length > 0 && (
              <Paper withBorder p="md">
                <Text fw={600}>Annahmen und offene Punkte</Text>
                <List mt="xs">
                  {proposal.assumptions.map((value) => (
                    <List.Item key={value}>{value}</List.Item>
                  ))}
                </List>
              </Paper>
            )}
            <details open>
              <summary>Arbeitsschritte ({proposal.steps.length})</summary>
              <List type="ordered" mt="sm">
                {proposal.steps.map((row) => (
                  <List.Item key={row.id}>
                    <Text fw={600} size="sm">
                      {row.title}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {row.notes}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </details>
            <details open>
              <summary>Material ({proposal.materials.length})</summary>
              <List mt="sm">
                {proposal.materials.map((row) => (
                  <List.Item key={row.id}>
                    {row.title} ·{' '}
                    {row.quantity === null ? 'Menge noch offen' : `${row.quantity} ${row.unit}`} ·{' '}
                    {row.unit_price === null ? 'Preis noch offen' : money(row.unit_price)}
                    {row.notes && (
                      <Text size="sm" c="dimmed">
                        {row.notes}
                      </Text>
                    )}
                  </List.Item>
                ))}
              </List>
            </details>
            <details open>
              <summary>Werkzeuge ({proposal.tools.length})</summary>
              <List mt="sm">
                {proposal.tools.map((row) => (
                  <List.Item key={row.id}>
                    {row.title} · {row.source}
                    {row.notes && (
                      <Text size="sm" c="dimmed">
                        {row.notes}
                      </Text>
                    )}
                  </List.Item>
                ))}
              </List>
            </details>
            <Text size="sm" c="dimmed">
              Nach dem Übernehmen kannst du alle Listen bearbeiten. Gespeichert wird erst über
              „Eigenleistung speichern“.
            </Text>
            <ErrorBox value={failure} />
            <ActionBar>
              <Button variant="default" disabled={busy} onClick={() => setProposal(null)}>
                Zurück zum Gespräch
              </Button>
              <Button
                loading={busy}
                onClick={async () => {
                  if (pending.current) return;
                  pending.current = true;
                  setBusy(true);
                  try {
                    await onApply(proposal);
                  } catch (error) {
                    setFailure(error);
                  } finally {
                    pending.current = false;
                    setBusy(false);
                  }
                }}
              >
                Vorschlag übernehmen & bearbeiten
              </Button>
            </ActionBar>
          </>
        )}
      </Stack>
    </Editor>
  );
}
