import type { BadgeProps, TextInputProps } from '@mantine/core';
import { Badge, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { projectID } from './project-context';

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="actions phb-action-bar">{children}</div>;
}
/** Remove only this dialog's deep-link fields after an actual close/save. */
export function useDialogRouteCleanup(opened: boolean, keys: string[]) {
  const [params] = useSearchParams();
  const navigate = useNavigate(),
    { hash } = useLocation();
  const wasOpen = useRef(false),
    signature = keys.join('|');
  useEffect(() => {
    const closed = wasOpen.current && !opened;
    wasOpen.current = opened;
    if (!closed) return;
    const next = new URLSearchParams(params);
    for (const key of signature.split('|')) next.delete(key);
    if (next.toString() !== params.toString())
      navigate({ search: next.toString() ? '?' + next.toString() : '', hash }, { replace: true });
  }, [opened, params, signature, navigate, hash]);
}
export function CardHeading({ children }: { children: ReactNode }) {
  return <div className="phb-card-heading">{children}</div>;
}
export function StatusPill(props: BadgeProps) {
  return <Badge variant="light" {...props} className={'phb-status ' + (props.className || '')} />;
}
export function SearchField(props: TextInputProps) {
  return (
    <TextInput
      leftSection={<IconSearch size={17} />}
      aria-label={typeof props.label === 'string' ? props.label : props.placeholder || 'Suchen'}
      {...props}
    />
  );
}
export function RowAction({
  children,
  onActivate,
}: {
  children: ReactNode;
  onActivate: () => void;
}) {
  return (
    <UnstyledButton
      className="phb-primary-link"
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
    >
      {children}
    </UnstyledButton>
  );
}
export function DocumentPreview({
  url,
  title,
  image = false,
}: {
  url: string;
  title: string;
  image?: boolean;
}) {
  return (
    <aside className="phb-document-preview" aria-label={title}>
      {image ? <img src={url} alt={title} /> : <iframe src={url} title={title} />}
    </aside>
  );
}
export function useViewState<T>(name: string, initial: T) {
  const key = `phb-view:${projectID}:${typeof location === 'undefined' ? '' : location.pathname}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw);
      return typeof parsed === typeof initial ? parsed : initial;
    } catch {
      return initial;
    }
  });
  const save = (next: T | ((old: T) => T)) =>
    setValue((old) => {
      const result = typeof next === 'function' ? (next as (old: T) => T)(old) : next;
      try {
        localStorage.setItem(key, JSON.stringify(result));
      } catch {}
      return result;
    });
  return [value, save] as const;
}

const impactFields: Record<string, string> = {
  gross: 'Brutto',
  net: 'Netto',
  vat: 'Umsatzsteuer',
  gross_amount: 'Bruttobetrag',
  net_amount: 'Nettobetrag',
  paid_amount: 'Bezahlt',
  expected: 'Erwartete Förderung',
  confirmed: 'Bestätigte Förderung',
  received: 'Erhaltene Förderung',
  contractor_id: 'Firma',
  offer_id: 'Angebot',
  budget_line_id: 'Kostenplanposition',
  assignment_type: 'Zuordnung',
  amount: 'Betrag',
  principal: 'Kreditsumme',
};
export function ChangePreview({
  original,
  changes,
}: {
  original: Record<string, unknown>;
  changes: Record<string, unknown>;
}) {
  const changed = Object.keys(impactFields).filter(
    (key) => key in changes && String(original[key] ?? '') !== String(changes[key] ?? ''),
  );
  if (!changed.length) return null;
  return (
    <details className="phb-change-impact">
      <summary>{changed.length} Änderungen prüfen</summary>
      <p>
        Die Änderungen werden erst beim Speichern übernommen. Bestehende Buchungen und Zuordnungen
        werden dabei geprüft.
      </p>
      <ul>
        {changed.map((key) => (
          <li key={key}>
            {impactFields[key]}:{' '}
            {key.endsWith('_id')
              ? 'Zuordnung geändert – bitte die Auswahl im Formular prüfen.'
              : String(original[key] ?? 'leer') + ' → ' + String(changes[key] ?? 'leer')}
          </li>
        ))}
      </ul>
    </details>
  );
}
