import { Accordion, Anchor, Button, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, Editor, ErrorBox, type Row } from './core';
import { glossarySourceURL } from './glossary';
export function AIResult() {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    id = Number(params.get('ai_result'));
  const query = useQuery({
    queryKey: ['ai-result', id],
    enabled: !!id,
    queryFn: () => api('/api/ai-actions/' + id),
    refetchInterval: (q) =>
      ['Fertig', 'Fehler', 'Unterbrochen', 'Ausgeblendet'].includes(q.state.data?.job?.status || '')
        ? false
        : 2500,
  });
  if (!id) return null;
  const result = query.data?.result || {},
    proposal = result.proposal;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('ai_result');
    setParams(next, { replace: true });
  };
  return (
    <Editor
      opened
      title={query.data?.job?.filename || 'Gespeichertes KI-Ergebnis'}
      onClose={close}
      size="xl"
    >
      <Stack>
        <ErrorBox value={query.error} />
        <Text size="sm">
          {query.data?.job?.status} · {query.data?.job?.stage}
        </Text>
        {query.data?.job?.error && <ErrorBox value={query.data.job.error} />}
        <Text style={{ whiteSpace: 'pre-wrap' }}>
          {result.answer || result.report?.explanation || proposal?.summary || ''}
        </Text>
        {(result.questions || result.report?.questions || []).map((question: string, i: number) => (
          <Text key={i} size="sm">
            • {question}
          </Text>
        ))}
        {proposal && (
          <Accordion multiple>
            {[
              ['steps', 'Arbeitsschritte'],
              ['materials', 'Material'],
              ['tools', 'Werkzeuge'],
            ].map(([key, label]) => (
              <Accordion.Item key={key} value={key}>
                <Accordion.Control>{label}</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {(proposal[key] || []).map((row: Row, i: number) => (
                      <Text key={i} size="sm">
                        {i + 1}. {row.title}
                        {row.quantity ? ' · ' + row.quantity + ' ' + row.unit : ''}
                        {row.notes ? ' · ' + row.notes : ''}
                      </Text>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
        {(result.report?.sources || [])
          .filter((source: Row) => glossarySourceURL(source.url))
          .map((source: Row) => (
            <Anchor key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </Anchor>
          ))}
        {query.data?.action === 'funding_check' && (
          <Button onClick={() => navigate('/energieplanung?funding_plan=' + query.data?.target)}>
            Förderplanung und Ergebnis prüfen
          </Button>
        )}
        {proposal && (
          <Button onClick={() => navigate('/eigenleistungen?ai_job=' + id)}>
            Vorschlag in neuer Eigenleistung bearbeiten
          </Button>
        )}
      </Stack>
    </Editor>
  );
}
