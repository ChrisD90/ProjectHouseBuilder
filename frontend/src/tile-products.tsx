import { ActionIcon, Anchor, FileButton, NumberInput, TextInput } from '@mantine/core';
import {
  IconChevronRight,
  IconExternalLink,
  IconPhotoPlus,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { money } from './core';
import { projectURL } from './project-context';
import { TileInfo } from './tile-info';

export type TileProduct = {
  id: string;
  name: string;
  url: string;
  price: number | null;
  image_document_id: number | null;
};
export const newTileProduct = (): TileProduct => ({
  id: crypto.randomUUID(),
  name: '',
  url: '',
  price: null,
  image_document_id: null,
});
const safeLink = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};
export function TileProducts({
  products,
  quantity,
  busy,
  open,
  onToggle,
  onChange,
  onUpload,
}: {
  products: TileProduct[];
  quantity: number;
  busy: boolean;
  open: boolean;
  onToggle: (value: boolean) => void;
  onChange: (rows: TileProduct[]) => void;
  onUpload: (id: string, file: File) => void;
}) {
  const update = (id: string, changes: Partial<TileProduct>) =>
    onChange(products.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  return (
    <details
      className="tile-cut-list tile-product-list"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="tile-section-heading tile-list-heading">
        <span>
          <IconChevronRight size={15} className="tile-list-chevron" data-open={open} />
          Fliesenauswahl ({products.length})
        </span>
        <ActionIcon
          className="tile-list-add"
          variant="subtle"
          size="sm"
          aria-label="Fliese hinzufügen"
          title="Fliese hinzufügen"
          disabled={busy || products.length >= 30}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onChange([...products, newTileProduct()]);
            onToggle(true);
          }}
        >
          <IconPlus size={16} />
        </ActionIcon>
        <TileInfo
          title="Fliesenauswahl"
          text={`Vergleiche bis zu 30 Fliesen im Format der aktuellen Planung. Der Gesamtpreis entspricht dem Stückpreis × ${quantity} geplanten Einkaufsfliesen inklusive Reserve. Einträge sind Alternativen und werden nicht aufsummiert oder ins Projektbudget gebucht. Bilder (JPG, PNG, WEBP) werden als Projektunterlagen abgelegt und mit dem Plan gespeichert. Änderungen werden mit „Speichern“ gesichert.`}
        />
      </summary>
      {!products.length ? (
        <p className="tile-products-empty">Über + eine Fliese hinzufügen.</p>
      ) : (
        <div className="tile-products-scroll">
          <div className="tile-product-columns" aria-hidden="true">
            <span>Bild</span>
            <span>Bezeichnung</span>
            <span>URL</span>
            <span>Preis / Fliese (€)</span>
            <span>Gesamtpreis</span>
            <span />
          </div>
          {products.map((row) => (
            <div className="tile-product-row" key={row.id}>
              <div className="tile-product-image">
                <FileButton
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(file) => file && onUpload(row.id, file)}
                >
                  {(props) => (
                    <button
                      {...props}
                      type="button"
                      className="tile-product-upload"
                      disabled={busy}
                      aria-label={
                        row.image_document_id ? 'Fliesenbild ersetzen' : 'Fliesenbild hochladen'
                      }
                    >
                      {row.image_document_id ? (
                        <img
                          src={projectURL(
                            '/api/project-documents/' + row.image_document_id + '/preview',
                          )}
                          alt={row.name || 'Fliese'}
                          loading="lazy"
                        />
                      ) : (
                        <IconPhotoPlus size={20} />
                      )}
                    </button>
                  )}
                </FileButton>
                {row.image_document_id && (
                  <ActionIcon
                    className="tile-product-image-remove"
                    size={15}
                    variant="filled"
                    aria-label="Bildverknüpfung entfernen"
                    disabled={busy}
                    onClick={() => update(row.id, { image_document_id: null })}
                  >
                    <IconX size={11} />
                  </ActionIcon>
                )}
              </div>
              <TextInput
                size="xs"
                aria-label="Bezeichnung der Fliese"
                placeholder="Bezeichnung"
                maxLength={200}
                disabled={busy}
                value={row.name}
                onChange={(event) => update(row.id, { name: event.currentTarget.value })}
              />
              <TextInput
                size="xs"
                aria-label="Produkt-URL"
                placeholder="https://…"
                maxLength={2000}
                disabled={busy}
                value={row.url}
                onChange={(event) => update(row.id, { url: event.currentTarget.value })}
                rightSection={
                  safeLink(row.url) && (
                    <Anchor
                      href={safeLink(row.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Produktseite öffnen"
                    >
                      <IconExternalLink size={14} />
                    </Anchor>
                  )
                }
              />
              <NumberInput
                size="xs"
                aria-label="Preis pro Fliese"
                min={0}
                max={999999999}
                decimalScale={2}
                fixedDecimalScale
                decimalSeparator=","
                thousandSeparator="."
                hideControls
                disabled={busy}
                value={row.price ?? ''}
                onChange={(value) =>
                  update(row.id, {
                    price: typeof value === 'number' ? value : value === '' ? null : Number(value),
                  })
                }
              />
              <span className="tile-product-total">
                {row.price === null || !Number.isFinite(row.price)
                  ? '—'
                  : money((Math.round(row.price * 100) * quantity) / 100)}
              </span>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                aria-label="Fliese entfernen"
                disabled={busy}
                onClick={() => onChange(products.filter((item) => item.id !== row.id))}
              >
                <IconTrash size={15} />
              </ActionIcon>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
