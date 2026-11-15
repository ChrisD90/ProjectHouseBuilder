import { ActionIcon, Group, Paper, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconDownload, IconEye, IconFileText, IconPencil } from '@tabler/icons-react';
import { Row } from './core';
import { projectURL } from './project-context';
import './document-cards.css';
export function DocumentCards({
  documents,
  onOpen,
}: {
  documents: Row[];
  onOpen: (row: Row) => void;
}) {
  return (
    <div className="project-document-grid">
      {documents.map((document) => {
        const preview = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt'].includes(
          document.extension,
        );
        const uploaded = Date.parse(document.uploaded_at || '');
        return (
          <Paper
            component="article"
            withBorder
            className="project-document-card"
            key={document.id}
            data-document-id={document.id}
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest('a,button')) onOpen(document);
            }}
          >
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Group gap={4} wrap="nowrap" c="dimmed" title={document.filename}>
                <IconFileText size={16} aria-hidden="true" />
                <Text size="10px" tt="uppercase">
                  {String(document.extension || '').replace('.', '')}
                </Text>
              </Group>
              <Text size="10px" c="dimmed">
                V{document.current_version || 1}
              </Text>
            </Group>
            <UnstyledButton
              className="project-document-card-open"
              aria-label={'Dokument ' + document.title + ' bearbeiten'}
              onClick={() => onOpen(document)}
            >
              <Text
                className="project-document-title"
                fw={600}
                size="sm"
                lineClamp={2}
                title={document.title}
              >
                {document.title}
              </Text>
              <Text size="xs" c="dimmed" truncate title={document.filename}>
                {document.filename}
              </Text>
              <Text
                size="xs"
                truncate
                title={[document.category, document.area].filter(Boolean).join(' · ')}
              >
                {[document.category, document.area].filter(Boolean).join(' · ')}
              </Text>
              <Text size="xs" c="dimmed" truncate title={document.description || document.tags}>
                {document.description || document.tags || '\u00a0'}
              </Text>
            </UnstyledButton>
            <Group justify="space-between" gap={4} wrap="nowrap">
              <Text size="10px" c="dimmed" title={document.uploaded_at}>
                {Number.isFinite(uploaded)
                  ? new Intl.DateTimeFormat(navigator.language || 'de-DE').format(uploaded)
                  : 'Ohne Datum'}
              </Text>
              <Group gap={4} wrap="nowrap">
                {preview && (
                  <Tooltip label="Dokument ansehen">
                    <ActionIcon
                      component="a"
                      variant="default"
                      size="sm"
                      aria-label="Dokument ansehen"
                      href={projectURL('/api/project-documents/' + document.id + '/preview')}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconEye size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip label="Herunterladen">
                  <ActionIcon
                    component="a"
                    variant="default"
                    size="sm"
                    aria-label="Dokument herunterladen"
                    href={projectURL('/api/project-documents/' + document.id + '/download')}
                  >
                    <IconDownload size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Bearbeiten">
                  <ActionIcon
                    variant="default"
                    size="sm"
                    aria-label="Dokument bearbeiten"
                    onClick={() => onOpen(document)}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Paper>
        );
      })}
      {!documents.length && (
        <Text size="sm" c="dimmed">
          Keine passenden Projektunterlagen.
        </Text>
      )}
    </div>
  );
}
