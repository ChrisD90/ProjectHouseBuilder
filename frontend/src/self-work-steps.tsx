import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Checkbox, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconGripVertical } from '@tabler/icons-react';
import type { Step } from './self-work-types';
import { useEffect } from 'react';

type Props = {
  onDraggingChange: (dragging: boolean) => void;
  steps: Step[];
  onChange: (steps: Step[]) => void;
  onOpen: (id: string) => void;
  disabled?: boolean;
};

function StepRow({
  row,
  index,
  total,
  onToggle,
  onOpen,
  disabled,
}: {
  row: Step;
  index: number;
  total: number;
  onToggle: (done: boolean) => void;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled });
  return (
    <div
      ref={setNodeRef}
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={total}
      className={'self-work-step-row' + (isDragging ? ' self-work-step-dragging' : '')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Tooltip label="Ziehen zum Verschieben · mit Tastatur: Leertaste, Pfeiltasten, Leertaste">
        <ActionIcon
          variant="subtle"
          className="self-work-step-grip"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={'Arbeitsschritt ' + (index + 1) + ' verschieben'}
          disabled={disabled}
        >
          <IconGripVertical size={18} />
        </ActionIcon>
      </Tooltip>
      <Text component="span" size="sm" c="dimmed" className="self-work-step-number" aria-hidden>
        {index + 1}.
      </Text>
      <Checkbox
        checked={row.done}
        disabled={disabled}
        aria-label={'Schritt ' + (index + 1) + ' erledigt'}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <UnstyledButton
        className="self-work-step-link"
        disabled={disabled}
        aria-label={'Details: ' + (row.title || 'Arbeitsschritt ' + (index + 1))}
        onClick={onOpen}
      >
        <Text
          component="span"
          truncate
          title={row.title}
          td={row.done ? 'line-through' : undefined}
          c={row.done ? 'dimmed' : undefined}
        >
          {row.title || 'Arbeitsschritt ohne Bezeichnung'}
        </Text>
      </UnstyledButton>
    </div>
  );
}

export function SelfWorkSteps({ steps, onChange, onOpen, disabled, onDraggingChange }: Props) {
  useEffect(() => () => onDraggingChange(false), [onDraggingChange]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const title = (id: string | number) => steps.find((x) => x.id === id)?.title || 'Arbeitsschritt';
  return (
    <DndContext
      autoScroll={{ canScroll: (element) => element.classList.contains('self-work-list-content') }}
      onDragStart={() => onDraggingChange(true)}
      onDragCancel={() => onDraggingChange(false)}
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Zum Verschieben Leertaste drücken. Mit Pfeil hoch oder runter die Position ändern. Mit Leertaste ablegen oder mit Escape abbrechen.',
        },
        announcements: {
          onDragStart: ({ active }) => title(active.id) + ' aufgenommen.',
          onDragOver: ({ over }) =>
            over
              ? 'Neue Position ' + (steps.findIndex((x) => x.id === over.id) + 1) + '.'
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? title(active.id) +
                ' auf Position ' +
                (steps.findIndex((x) => x.id === over.id) + 1) +
                ' verschoben.'
              : 'Verschieben beendet.',
          onDragCancel: () => 'Verschieben abgebrochen.',
        },
      }}
      onDragEnd={({ active, over }) => {
        onDraggingChange(false);
        if (!disabled && over && active.id !== over.id) {
          const from = steps.findIndex((x) => x.id === active.id),
            to = steps.findIndex((x) => x.id === over.id);
          if (from >= 0 && to >= 0) onChange(arrayMove(steps, from, to));
        }
      }}
    >
      <SortableContext items={steps.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <div role="list" aria-label="Arbeitsschritte" className="self-work-sortable-steps">
          {steps.map((row, index) => (
            <StepRow
              key={row.id}
              row={row}
              index={index}
              total={steps.length}
              disabled={disabled}
              onOpen={() => onOpen(row.id)}
              onToggle={(done) =>
                onChange(steps.map((x) => (x.id === row.id ? { ...x, done } : x)))
              }
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
