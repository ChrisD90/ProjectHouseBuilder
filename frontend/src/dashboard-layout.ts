export type WidgetConfig = {
  title?: string;
  source?: string;
  status?: string;
  search?: string;
  trade?: string;
  person?: number;
  month?: string;
  aggregation?: string;
  note_id?: number;
  links?: string[];
};
export type Widget = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
};
export type Layout = { version: 1; widgets: Widget[] };
export const catalog = [
  {
    type: 'events',
    title: 'Nächste Termine',
    description: 'Die nächsten sieben Tage mit Firma und Gewerk.',
    min: [4, 2],
    source: 'events',
    group: 'Projekt',
  },
  {
    type: 'calendar',
    title: 'Minikalender',
    description: 'Monatsübersicht mit direktem Sprung zum Termin.',
    min: [6, 3],
    source: 'events',
    group: 'Projekt',
  },
  {
    type: 'todos',
    title: 'Offene To-dos',
    description: 'Aufgaben direkt öffnen und abhaken.',
    min: [4, 2],
    source: 'todos',
    group: 'Projekt',
  },
  {
    type: 'note',
    title: 'Angeheftete Notiz',
    description: 'Eine vorhandene Notiz im Blick behalten.',
    min: [3, 2],
    source: 'notes',
    group: 'Projekt',
  },
  {
    type: 'deadlines',
    title: 'Fristen & Vorbereitung',
    description: 'Anträge, Rückgaben und fällige Projektaufgaben.',
    min: [4, 2],
    source: 'deadlines',
    group: 'Projekt',
  },
  {
    type: 'receipts',
    title: 'Zu bezahlen',
    description: 'Offener Betrag und die nächsten Rechnungen.',
    min: [4, 2],
    source: 'receipts',
    group: 'Finanzen',
  },
  {
    type: 'credit',
    title: 'Restbudget Kredit',
    description: 'Noch verfügbares Kreditbudget einschließlich nicht abgerufener Mittel.',
    min: [3, 1],
    source: 'finance',
    group: 'Finanzen',
  },
  {
    type: 'equity',
    title: 'Rechnungen aus Eigenkapital',
    description: 'Tatsächlich dem Eigenkapital zugeordnete Zahlungsanteile.',
    min: [3, 1],
    source: 'finance',
    group: 'Finanzen',
  },
  {
    type: 'expenses',
    title: 'Summe der Ausgaben',
    description: 'Rechnungszahlungen aus Eigenkapital plus bereits abgerufenes Kreditkapital.',
    min: [3, 1],
    source: 'finance',
    group: 'Finanzen',
  },
  {
    type: 'pending',
    title: 'Mittelabrufe in Prüfung',
    description: 'Noch nicht ausgezahlte Beträge eingereichter Abrufe.',
    min: [3, 1],
    source: 'finance',
    group: 'Finanzen',
  },
  {
    type: 'offers',
    title: 'Angebote',
    description: 'Angebote nach Status mit ihren Bruttobeträgen.',
    min: [4, 2],
    source: 'offers',
    group: 'Projekt',
  },
  {
    type: 'self_work',
    title: 'Eigenleistungen',
    description: 'Vorhaben mit Plan- und Ist-Kosten.',
    min: [4, 2],
    source: 'self_work',
    group: 'Umsetzung',
  },
  {
    type: 'shopping',
    title: 'Einkaufsliste',
    description: 'Noch benötigte Materialien und Werkzeuge.',
    min: [4, 2],
    source: 'shopping',
    group: 'Umsetzung',
  },
  {
    type: 'hours',
    title: 'Geleistete Stunden',
    description: 'Erfasste Stunden; geplante Kalenderzeiten bleiben außen vor.',
    min: [3, 1],
    source: 'hours',
    group: 'Umsetzung',
  },
  {
    type: 'inbox',
    title: 'Dokumenteneingang',
    description: 'Neue Dateien aus deinem überwachten Ordner.',
    min: [4, 2],
    source: 'inbox',
    group: 'Projekt',
  },
  {
    type: 'links',
    title: 'Schnellzugriffe',
    description: 'Deine Wege zu Projektbereichen und Werkstatt.',
    min: [3, 2],
    source: '',
    group: 'Eigene Kacheln',
  },
  {
    type: 'metric',
    title: 'Eigene Kennzahl',
    description: 'Anzahl oder Summe aus einer gefilterten Datenquelle.',
    min: [3, 1],
    source: '',
    group: 'Eigene Kacheln',
  },
  {
    type: 'list',
    title: 'Eigene Liste',
    description: 'Gefilterte Rechnungen, Aufgaben, Angebote, Eigenleistungen oder Stunden.',
    min: [4, 2],
    source: '',
    group: 'Eigene Kacheln',
  },
  {
    type: 'progress',
    title: 'Fortschritt',
    description:
      'Erledigte Aufgaben, abgeschlossene Eigenleistungen, angenommene Angebote oder bezahlte Rechnungen.',
    min: [3, 2],
    source: '',
    group: 'Eigene Kacheln',
  },
];
export const spec = (type: string) => catalog.find((x) => x.type === type)!;
export const defaultLayout = (): Layout => ({
  version: 1,
  widgets: ['events', 'todos', 'receipts', 'deadlines'].map((type, i) => ({
    id: type,
    type,
    x: (i % 2) * 6,
    y: Math.floor(i / 2) * 2,
    w: 6,
    h: 2,
    config: {},
  })),
});
const overlaps = (a: Widget, b: Widget) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// The edited card wins its requested cells. Other cards move down, never disappear.
export function place(items: Widget[], target: Widget): Widget[] {
  const fixed: Widget[] = [target];
  for (const old of items
    .filter((x) => x.id !== target.id)
    .sort((a, b) => a.y - b.y || a.x - b.x)) {
    const next = { ...old };
    while (fixed.some((x) => overlaps(x, next))) next.y++;
    fixed.push(next);
  }
  return items.map((x) => fixed.find((y) => y.id === x.id)!);
}
export function append(items: Widget[], item: Widget): Widget[] {
  for (let y = 0; y <= 200; y++)
    for (let x = 0; x <= 12 - item.w; x++) {
      const next = { ...item, x, y };
      if (!items.some((old) => overlaps(old, next))) return [...items, next];
    }
  return items;
}
export const sourceFor = (w: Widget) =>
  ['metric', 'list', 'progress'].includes(w.type) ? w.config.source! : spec(w.type).source;
