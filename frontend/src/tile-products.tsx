import { ActionIcon, Anchor, FileButton, NumberInput, TextInput, Popover } from '@mantine/core';
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
  material = 'tile',
  products,
  quantity,
  busy,
  open,
  onToggle,
  onChange,
  onUpload,
}: {
  material?: 'tile' | 'osb';
  products: TileProduct[];
  quantity: number;
  busy: boolean;
  open: boolean;
  onToggle: (value: boolean) => void;
  onChange: (rows: TileProduct[]) => void;
  onUpload: (id: string, file: File) => void;
}) {
  const piece = material === 'osb' ? 'Platte' : 'Fliese',
    plural = material === 'osb' ? 'Platten' : 'Fliesen';
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
          {plural}auswahl ({products.length})
        </span>
        <ActionIcon
          className="tile-list-add"
          variant="subtle"
          size="sm"
          aria-label={piece + ' hinzufügen'}
          title={piece + ' hinzufügen'}
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
          title={plural + 'auswahl'}
          text={`Vergleiche bis zu 30 ${plural} im Format der aktuellen Planung. Der Gesamtpreis entspricht dem Stückpreis × ${quantity} geplanten Einkaufs${plural.toLowerCase()} inklusive Reserve. Einträge sind Alternativen und werden nicht aufsummiert oder ins Projektbudget gebucht. Bilder (JPG, PNG, WEBP) werden als Projektunterlagen abgelegt und mit dem Plan gespeichert. Änderungen werden mit „Speichern“ gesichert.`}
        />
      </summary>
      {!products.length ? (
        <p className="tile-products-empty">Über + eine {piece} hinzufügen.</p>
      ) : (
        <div className="tile-products-scroll">
          <div className="tile-product-columns" aria-hidden="true">
            <span>Bild</span>
            <span>Bezeichnung</span>
            <span>URL</span>
            <span>Preis / {piece} (€)</span>
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
                        row.image_document_id ? piece + 'nbild ersetzen' : piece + 'nbild hochladen'
                      }
                    >
                      {row.image_document_id ? (
                        <img
                          src={projectURL(
                            '/api/project-documents/' + row.image_document_id + '/preview',
                          )}
                          alt={row.name || piece}
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
                aria-label={'Bezeichnung: ' + piece}
                placeholder="Bezeichnung"
                maxLength={200}
                disabled={busy}
                value={row.name}
                onChange={(event) => update(row.id, { name: event.currentTarget.value })}
              />
              <Popover width={300} position="bottom-end" withinPortal>
                <Popover.Target>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label="Produkt-URL bearbeiten"
                    title={row.url || 'Produkt-URL hinzufügen'}
                    disabled={busy}
                  >
                    <IconExternalLink size={15} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown>
                  <TextInput
                    size="xs"
                    label="Produkt-URL"
                    placeholder="https://…"
                    maxLength={2000}
                    disabled={busy}
                    value={row.url}
                    onChange={(event) => update(row.id, { url: event.currentTarget.value })}
                  />
                  {safeLink(row.url) && (
                    <Anchor
                      size="xs"
                      href={safeLink(row.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Produktseite öffnen
                    </Anchor>
                  )}
                </Popover.Dropdown>
              </Popover>
              <NumberInput
                size="xs"
                aria-label={'Preis pro ' + piece}
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
                aria-label={piece + ' entfernen'}
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
