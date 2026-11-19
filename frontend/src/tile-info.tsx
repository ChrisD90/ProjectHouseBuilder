import { ActionIcon, Popover, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

export function TileInfo({
  title,
  text,
  warning = false,
}: {
  title: string;
  text: string;
  warning?: boolean;
}) {
  return (
    <span
      className="tile-info"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Popover width={320} position="bottom-end" withinPortal shadow="md">
        <Popover.Target>
          <ActionIcon
            variant="subtle"
            size="sm"
            color={warning ? 'orange' : undefined}
            aria-label={'Hinweise zu ' + title}
          >
            <IconInfoCircle size={17} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown
          style={{ maxWidth: 'calc(100vw - 24px)', maxHeight: '60dvh', overflowY: 'auto' }}
        >
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {text}
          </Text>
        </Popover.Dropdown>
      </Popover>
    </span>
  );
}
export function TileHeading({
  title,
  info,
  large = false,
  warning = false,
}: {
  title: string;
  info: string;
  large?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="tile-section-heading">
      {large ? (
        <Title order={3}>{title}</Title>
      ) : (
        <Text size="sm" fw={600}>
          {title}
        </Text>
      )}
      <TileInfo title={title} text={info} warning={warning} />
    </div>
  );
}
