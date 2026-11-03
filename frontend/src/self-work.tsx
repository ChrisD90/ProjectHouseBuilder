import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconArchive,
  IconArchiveOff,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconSparkles,
  IconTool,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SourceWork } from './work';
import { api, Editor, ErrorBox, money, success, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { useDirtyGuard } from './shell';
import { ActionBar, SearchField, StatusPill, useViewState } from './ui';
import { SelfWorkAI } from './self-work-ai';
import { SelfWorkSteps } from './self-work-steps';
import { SelfWorkInvoices } from './self-work-invoices';
import { draftOf, emptyPlan, newID } from './self-work-types';
import type { Material, Plan, PlanDraft, Proposal, Step, Tool } from './self-work-types';
import './self-work.css';
import { SortSelect, compareText } from './list-sorting';

type Listing = {
  plans: Plan[];
  tasks: { id: number; label: string }[];
  receipts: { id: number; label: string; status: string; amount: number }[];
};
function SupplyRow({
  title,
  quantity,
  cost,
  onClick,
}: {
  title: string;
  quantity: string;
  cost: number | null;
  onClick: () => void;
}) {
  const shortTitle =
    Array.from(title).length > 60 ? Array.from(title).slice(0, 60).join('') + '…' : title;
  return (
    <UnstyledButton
      className="self-work-supply-row"
      onClick={onClick}
      aria-label={'Details: ' + title}
    >
      <Text component="span" className="self-work-supply-title" title={title}>
        {shortTitle}
      </Text>
      <Text
        component="span"
        size="xs"
        c="dimmed"
        className="self-work-supply-quantity"
        title={quantity}
      >
        {quantity}
      </Text>
      <Text component="span" size="sm" className="self-work-supply-cost">
        {cost === null ? 'Kosten offen' : 'ca. ' + money(cost)}
      </Text>
    </UnstyledButton>
  );
}
const numeric = (value: string | number): number | null => (value === '' ? null : Number(value));
function ListFrame({
  title,
  backLabel,
  addLabel,
  onBack,
  onAdd,
  full,
  children,
}: {
  title: string;
  backLabel: string;
  addLabel: string;
  onBack?: () => void;
  onAdd: () => void;
  full: boolean;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null),
    listScroll = useRef(0);
  const showingDetail = !!onBack;
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = showingDetail ? 0 : listScroll.current;
  }, [showingDetail]);
  return (
    <div className="self-work-list-frame">
      <Group className="self-work-list-header" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          {onBack && (
            <Tooltip label={backLabel}>
              <ActionIcon variant="subtle" aria-label={backLabel} onClick={onBack}>
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <Text size="sm" fw={600}>
            {title}
          </Text>
        </Group>
        {!onBack && (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={onAdd}
            disabled={full}
          >
            {addLabel}
          </Button>
        )}
      </Group>
      <div
        className="self-work-list-content"
        ref={contentRef}
        onScroll={(event) => {
          if (!showingDetail) listScroll.current = event.currentTarget.scrollTop;
        }}
      >
        <Stack gap="sm">{children}</Stack>
      </div>
    </div>
  );
}
export function SelfWorkPage() {
  const navigate = useNavigate();
  const [uploadTarget, setUploadTarget] = useState<number | null>(null);
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ['self-work'],
    queryFn: () => api<Listing>('/api/self-work'),
    staleTime: 0,
  });
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api('/api/ai/status'), staleTime: 60000 });
  const cache = useQueryClient(),
    ask = useConfirm(),
    pending = useRef(false);
  const [opened, setOpened] = useState(false),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [aiOpen, setAIOpen] = useState(false),
    [aiModel, setAIModel] = useState(''),
    [failure, setFailure] = useState<unknown>(null),
    [tab, setTab] = useState<string | null>('overview');
  const [search, setSearch] = useViewState('self-work-search', ''),
    [sort, setSort] = useViewState('sort', 'newest'),
    [status, setStatus] = useViewState('self-work-status', 'all'),
    [archive, setArchive] = useViewState('self-work-archive', 'active');
  const [invoicePlanID, setInvoicePlanID] = useState<number | null>(null);
  const invoicePlan = query.data?.plans.find((row) => row.id === invoicePlanID);
  const form = useForm<PlanDraft>({
    initialValues: emptyPlan(),
    validate: { title: (value) => (value.trim() ? null : 'Bitte eine Bezeichnung eingeben.') },
  });
  const [supplyDetail, setSupplyDetail] = useState<string | null>(null);
  const [draggingStep, setDraggingStep] = useState(false);
  function addStep() {
    const row: Step = { id: newID(), title: '', notes: '', done: false };
    form.setFieldValue('steps', [...form.values.steps, row]);
    setSupplyDetail(row.id);
  }
  function addMaterial() {
    const row: Material = {
      id: newID(),
      title: '',
      notes: '',
      quantity: null,
      unit: '',
      unit_price: null,
      status: 'Benötigt',
    };
    form.setFieldValue('materials', [...form.values.materials, row]);
    setSupplyDetail(row.id);
  }
  function addTool() {
    const row: Tool = {
      id: newID(),
      title: '',
      notes: '',
      source: 'Noch offen',
      cost: null,
      ready: false,
    };
    form.setFieldValue('tools', [...form.values.tools, row]);
    setSupplyDetail(row.id);
  }
  useDirtyGuard(opened && form.isDirty());
  useEffect(() => {
    if (uploadTarget && !opened) navigate('/belege?upload=1&self_work_id=' + uploadTarget);
  }, [uploadTarget, opened, navigate]);
  function startReceiptUpload(target: number) {
    if (pending.current) return;
    setInvoicePlanID(null);
    setOpened(false);
    setUploadTarget(target);
  }
  function edit(row?: Plan) {
    const values = row ? draftOf(row) : emptyPlan();
    form.setValues(values);
    form.setInitialValues(values);
    form.resetDirty(values);
    setID(row?.id || null);
    setTab('overview');
    setSupplyDetail(null);
    setFailure(null);
    setOpened(true);
  }
  useEffect(() => {
    const target = query.data?.plans.find((x) => x.id === Number(params.get('plan_id')));
    if (target) edit(target);
  }, [params.get('plan_id'), !!query.data]);
  async function save(archived?: boolean) {
    if (pending.current) return;
    if (form.validate().hasErrors) {
      setTab('overview');
      return;
    }
    for (const kind of ['steps', 'materials', 'tools'] as const) {
      if (form.values[kind].some((row) => !row.title.trim())) {
        setTab(kind);
        setSupplyDetail(form.values[kind].find((row) => !row.title.trim())?.id || null);
        setFailure(Error('Bitte allen Listeneinträgen eine Bezeichnung geben.'));
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const saved = await api('/api/self-work' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
        ...form.values,
        ...(archived === undefined ? {} : { archived }),
      });
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['self-work'] });
      await cache.invalidateQueries({ queryKey: ['cost-dashboard'] });
      await cache.invalidateQueries({ queryKey: ['projects'] });
      await cache.invalidateQueries({ queryKey: ['work-sources'] });
      success('Eigenleistung gespeichert.');
      return saved.plan.id as number;
    } catch (error) {
      setFailure(error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (
      pending.current ||
      !id ||
      !(await ask('Diese Eigenleistung mit ihren Listen endgültig löschen?'))
    )
      return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/self-work/' + id, 'DELETE');
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['self-work'] });
      await cache.invalidateQueries({ queryKey: ['cost-dashboard'] });
      await cache.invalidateQueries({ queryKey: ['projects'] });
      await cache.invalidateQueries({ queryKey: ['work-sources'] });
      success('Eigenleistung gelöscht.');
    } catch (error) {
      setFailure(error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function stepChange(index: number, values: Partial<Step>) {
    form.setFieldValue(
      'steps',
      form.values.steps.map((row, i) => (i === index ? { ...row, ...values } : row)),
    );
  }
  function materialChange(index: number, values: Partial<Material>) {
    form.setFieldValue(
      'materials',
      form.values.materials.map((row, i) => (i === index ? { ...row, ...values } : row)),
    );
  }
  function toolChange(index: number, values: Partial<Tool>) {
    form.setFieldValue(
      'tools',
      form.values.tools.map((row, i) => (i === index ? { ...row, ...values } : row)),
    );
  }
  function move(index: number, delta: number) {
    const rows = [...form.values.steps];
    [rows[index], rows[index + delta]] = [rows[index + delta], rows[index]];
    form.setFieldValue('steps', rows);
  }
  async function apply(proposal: Proposal) {
    if (
      (form.values.steps.length || form.values.materials.length || form.values.tools.length) &&
      !(await ask(
        'Die vorhandenen Arbeitsschritte, Material- und Werkzeuglisten durch diesen Vorschlag ersetzen? Deine Vorhabensbeschreibung bleibt erhalten.',
      ))
    )
      return;
    form.setValues({
      steps: proposal.steps,
      materials: proposal.materials,
      tools: proposal.tools,
      notes: [
        form.values.notes,
        proposal.summary,
        proposal.assumptions.length
          ? 'Annahmen des ChatGPT-Vorschlags:\n' + proposal.assumptions.join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    setAIOpen(false);
    setTab('steps');
  }
  const records = (query.data?.plans || [])
    .filter(
      (row) =>
        row.archived === (archive === 'archived') &&
        (status === 'all' || row.status === status) &&
        [row.title, row.description, row.location, row.task_label].some((value) =>
          value.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')),
        ),
    )
    .sort((a, b) => {
      const title = compareText(a.title, b.title);
      if (sort === 'az') return title || a.id - b.id;
      if (sort === 'za') return -title || a.id - b.id;
      if (sort === 'oldest') return a.id - b.id;
      if (sort === 'status')
        return (
          ['Geplant', 'In Arbeit', 'Erledigt'].indexOf(a.status) -
            ['Geplant', 'In Arbeit', 'Erledigt'].indexOf(b.status) ||
          title ||
          a.id - b.id
        );
      if (sort === 'planned-desc')
        return b.estimated_cost - a.estimated_cost || title || a.id - b.id;
      if (sort === 'actual-desc') return b.actual_cost - a.actual_cost || title || a.id - b.id;
      return b.id - a.id;
    });
  const taskOptions = (query.data?.tasks || []).map((task) => ({
    value: String(task.id),
    label: task.label,
  }));
  const linkedTask = taskOptions.some((task) => task.value === String(form.values.task_id));
  if (form.values.task_id && !linkedTask)
    taskOptions.push({
      value: String(form.values.task_id),
      label: 'Nicht mehr verfügbares Arbeitspaket',
    });
  const knownCosts =
    form.values.materials.reduce(
      (sum, row) => sum + (row.quantity ?? 0) * (row.unit_price ?? 0),
      0,
    ) + form.values.tools.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  return (
    <div className="page self-work-page">
      <PageHeader
        title="Eigenleistungen"
        description="Deine Vorhaben, Arbeitsschritte, Materialien und Werkzeuge an einem Ort."
      >
        <Button leftSection={<IconPlus size={17} />} onClick={() => edit()}>
          Eigenleistung planen
        </Button>
      </PageHeader>
      <Paper withBorder p="md" mb="lg">
        <Group align="end">
          <SearchField
            label="Eigenleistungen suchen"
            placeholder="Titel, Ort oder Arbeitspaket"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            style={{ flex: '1 1 240px' }}
          />
          <Select
            label="Status"
            value={status}
            onChange={(value) => setStatus(value || 'all')}
            data={[{ value: 'all', label: 'Alle Status' }, 'Geplant', 'In Arbeit', 'Erledigt']}
          />
          <Select
            label="Ansicht"
            value={archive}
            onChange={(value) => setArchive(value || 'active')}
            data={[
              { value: 'active', label: 'Aktuelle Vorhaben' },
              { value: 'archived', label: 'Archiv' },
            ]}
          />
          <SortSelect
            label
            value={sort}
            onChange={setSort}
            extra={[
              { value: 'status', label: 'Status' },
              { value: 'planned-desc', label: 'Höchste Plankosten' },
              { value: 'actual-desc', label: 'Höchste Ist-Kosten' },
            ]}
          />
        </Group>
      </Paper>
      <ErrorBox value={query.error} />
      {query.isPending ? (
        <Text c="dimmed">Eigenleistungen werden geladen …</Text>
      ) : !records.length ? (
        <Paper withBorder p="xl" className="self-work-empty">
          <IconTool size={34} />
          <Title order={3}>
            {search || status !== 'all'
              ? 'Keine passenden Eigenleistungen'
              : archive === 'archived'
                ? 'Noch keine archivierten Vorhaben'
                : 'Was möchtest du selbst machen?'}
          </Title>
          <Text c="dimmed">
            {archive === 'archived'
              ? 'Archivierte Eigenleistungen kannst du hier wieder öffnen.'
              : 'Zum Beispiel einen Raum streichen, den Boden verlegen oder ein Hochbeet bauen.'}
          </Text>
          {!search && status === 'all' && archive !== 'archived' && (
            <Button mt="sm" onClick={() => edit()}>
              Erste Eigenleistung planen
            </Button>
          )}
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
          {records.map((row) => {
            const done = row.steps.filter((step) => step.done).length;
            return (
              <Paper
                key={row.id}
                withBorder
                p="lg"
                className="self-work-card"
                onClick={(event) => {
                  if (
                    (event.target as HTMLElement).closest(
                      'button,a,input,select,textarea,[role="button"]',
                    )
                  )
                    return;
                  edit(row);
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <StatusPill
                    className="self-work-status"
                    color={
                      row.status === 'Erledigt'
                        ? 'green'
                        : row.status === 'In Arbeit'
                          ? 'blue'
                          : 'gray'
                    }
                  >
                    {row.status}
                  </StatusPill>
                  <Group gap={8} wrap="nowrap" className="self-work-corner-actions">
                    <Tooltip label="Eigenleistung bearbeiten">
                      <ActionIcon
                        variant="default"
                        className="self-work-corner-icon"
                        aria-label={'Eigenleistung bearbeiten: ' + row.title}
                        onClick={() => edit(row)}
                      >
                        <IconPencil size={18} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={'Rechnungen & Kassenzettel: ' + row.receipt_ids.length}>
                      <ActionIcon
                        variant="default"
                        className="self-work-corner-icon"
                        onClick={() => setInvoicePlanID(row.id)}
                        aria-label={'Rechnungen zu ' + row.title + ': ' + row.receipt_ids.length}
                      >
                        <IconReceipt size={17} />
                        <span className="self-work-action-count">{row.receipt_ids.length}</span>
                      </ActionIcon>
                    </Tooltip>
                    <SourceWork type="self_work" id={row.id} compact />
                  </Group>
                </Group>
                <UnstyledButton className="phb-primary-link" onClick={() => edit(row)}>
                  <Title order={3} lineClamp={2}>
                    {row.title}
                  </Title>
                </UnstyledButton>
                {row.location && (
                  <Text size="sm" c="dimmed">
                    {row.location}
                  </Text>
                )}
                <Text size="sm" lineClamp={2}>
                  {row.description || 'Beschreibung noch offen.'}
                </Text>
                {row.task_label && (
                  <Badge
                    component={Link}
                    to={'/?task_id=' + row.task_id}
                    variant="light"
                    className="self-work-task-label"
                    aria-label={'Arbeitspaket öffnen: ' + row.task_label}
                  >
                    {row.task_label}
                  </Badge>
                )}
                {row.steps.length > 0 && (
                  <div>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        Arbeitsschritte
                      </Text>
                      <Text size="xs">
                        {done} / {row.steps.length}
                      </Text>
                    </Group>
                    <Progress value={(done / row.steps.length) * 100} size="xs" mt={6} />
                  </div>
                )}
                <Text size="sm" c="dimmed" mt="auto">
                  {row.costs_complete
                    ? 'Plan: '
                    : row.estimated_cost
                      ? 'Plan (unvollständig): '
                      : 'Kosten noch offen'}
                  {(row.costs_complete || !!row.estimated_cost) && money(row.estimated_cost)}
                </Text>
                <Group justify="space-between">
                  <Text size="sm">Ist: {money(row.actual_cost)}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  Material bestellt / vorhanden: {money(row.procured_material_cost)}
                </Text>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
      <Text size="xs" c="dimmed" mt="lg">
        Plan-Kosten aus Material und Werkzeugen fließen in die Projektprognose ein. Ist-Kosten
        entstehen durch gebuchte Belege. Der Beschaffungsstatus löst keine Zahlung aus.
      </Text>
      <Editor
        opened={opened}
        title={id ? 'Eigenleistung bearbeiten' : 'Neue Eigenleistung'}
        dirty={form.isDirty()}
        changes={form.values}
        original={form.getInitialValues()}
        busy={busy}
        suspended={aiOpen}
        closeOnEscape={!draggingStep}
        onClose={() => setOpened(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Stack>
            <Tabs
              value={tab}
              onChange={(value) => {
                setTab(value);
                setSupplyDetail(null);
              }}
              keepMounted={false}
              className="self-work-tabs"
            >
              <Tabs.List grow>
                <Tabs.Tab value="overview">Vorhaben</Tabs.Tab>
                <Tabs.Tab value="steps">Schritte ({form.values.steps.length})</Tabs.Tab>
                <Tabs.Tab value="materials">Material ({form.values.materials.length})</Tabs.Tab>
                <Tabs.Tab value="tools">Werkzeuge ({form.values.tools.length})</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="overview" pt="md">
                <Stack>
                  <TextInput
                    label="Bezeichnung"
                    placeholder="Zum Beispiel Wohnzimmer verputzen"
                    required
                    maxLength={200}
                    {...form.getInputProps('title')}
                  />
                  <Textarea
                    label="Was möchtest du machen?"
                    description="Ergebnis, Maße und Untergrund helfen dir bei der Vorbereitung."
                    autosize
                    minRows={3}
                    maxRows={8}
                    maxLength={6000}
                    {...form.getInputProps('description')}
                  />
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput
                      label="Ort / Raum"
                      maxLength={200}
                      {...form.getInputProps('location')}
                    />
                    <Select
                      label="Deine Erfahrung"
                      data={['Einsteiger', 'Etwas Erfahrung', 'Erfahren']}
                      {...form.getInputProps('experience')}
                    />
                  </SimpleGrid>
                  <Select
                    label="Arbeitspaket verknüpfen (optional)"
                    description="Eine Verknüpfung zur Orientierung; das Arbeitspaket wird nicht verändert."
                    searchable
                    clearable
                    data={taskOptions}
                    value={form.values.task_id ? String(form.values.task_id) : null}
                    onChange={(value) =>
                      form.setFieldValue('task_id', value ? Number(value) : null)
                    }
                  />
                  {form.values.task_id && !linkedTask && (
                    <Alert color="yellow">
                      Das verknüpfte Arbeitspaket ist nicht mehr verfügbar. Du kannst die
                      Verknüpfung entfernen oder ein anderes auswählen. Deine Eigenleistung bleibt
                      erhalten.
                    </Alert>
                  )}
                  <Select
                    label="Status dieser Eigenleistung"
                    data={['Geplant', 'In Arbeit', 'Erledigt']}
                    {...form.getInputProps('status')}
                  />
                  <Textarea
                    label="Notizen und Planungshinweise"
                    autosize
                    minRows={3}
                    maxRows={8}
                    maxLength={6000}
                    {...form.getInputProps('notes')}
                  />
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="steps" pt="md">
                <ListFrame
                  title={supplyDetail ? 'Arbeitsschritt bearbeiten' : 'Arbeitsschritte'}
                  backLabel="Zurück zur Schrittliste"
                  addLabel="Arbeitsschritt hinzufügen"
                  onBack={supplyDetail ? () => setSupplyDetail(null) : undefined}
                  onAdd={addStep}
                  full={form.values.steps.length >= 100}
                >
                  {!supplyDetail && (
                    <SelfWorkSteps
                      onDraggingChange={setDraggingStep}
                      steps={form.values.steps}
                      onChange={(rows) => form.setFieldValue('steps', rows)}
                      onOpen={setSupplyDetail}
                      disabled={busy}
                    />
                  )}
                  {!form.values.steps.length && (
                    <Text size="sm" c="dimmed">
                      Plane deine Arbeit in einer sinnvollen Reihenfolge. Das Abhaken gilt nur für
                      diese Eigenleistung.
                    </Text>
                  )}
                  {form.values.steps.map(
                    (row, index) =>
                      row.id === supplyDetail && (
                        <Paper withBorder p="md" key={row.id}>
                          <Stack gap="sm">
                            <Group justify="space-between">
                              <Checkbox
                                label={'Schritt ' + (index + 1) + ' erledigt'}
                                checked={row.done}
                                onChange={(event) =>
                                  stepChange(index, { done: event.currentTarget.checked })
                                }
                              />
                              <Group gap={2}>
                                <Tooltip label="Nach oben">
                                  <ActionIcon
                                    variant="subtle"
                                    aria-label={'Schritt ' + (index + 1) + ' nach oben'}
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                  >
                                    <IconArrowUp size={16} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Nach unten">
                                  <ActionIcon
                                    variant="subtle"
                                    aria-label={'Schritt ' + (index + 1) + ' nach unten'}
                                    disabled={index === form.values.steps.length - 1}
                                    onClick={() => move(index, 1)}
                                  >
                                    <IconArrowDown size={16} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Schritt entfernen">
                                  <ActionIcon
                                    color="red"
                                    variant="subtle"
                                    aria-label={'Schritt ' + (index + 1) + ' entfernen'}
                                    onClick={() => {
                                      form.setFieldValue(
                                        'steps',
                                        form.values.steps.filter((r) => r.id !== row.id),
                                      );
                                      setSupplyDetail(null);
                                    }}
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Group>
                            <TextInput
                              label={'Arbeitsschritt ' + (index + 1)}
                              required
                              maxLength={200}
                              value={row.title}
                              onChange={(event) =>
                                stepChange(index, { title: event.currentTarget.value })
                              }
                            />
                            <Textarea
                              label="Vorgehen und Hinweise"
                              autosize
                              minRows={2}
                              maxRows={6}
                              maxLength={2000}
                              value={row.notes}
                              onChange={(event) =>
                                stepChange(index, { notes: event.currentTarget.value })
                              }
                            />
                          </Stack>
                        </Paper>
                      ),
                  )}
                </ListFrame>
              </Tabs.Panel>
              <Tabs.Panel value="materials" pt="md">
                <ListFrame
                  title={supplyDetail ? 'Material bearbeiten' : 'Materialien'}
                  backLabel="Zurück zur Materialliste"
                  addLabel="Material hinzufügen"
                  onBack={supplyDetail ? () => setSupplyDetail(null) : undefined}
                  onAdd={addMaterial}
                  full={form.values.materials.length >= 100}
                >
                  {!supplyDetail &&
                    form.values.materials.map((row) => (
                      <SupplyRow
                        key={row.id}
                        title={row.title || 'Material ohne Bezeichnung'}
                        quantity={
                          row.quantity === null
                            ? 'Menge offen'
                            : row.quantity.toLocaleString('de-DE') + ' ' + row.unit
                        }
                        cost={
                          row.quantity !== null && row.unit_price !== null
                            ? row.quantity * row.unit_price
                            : null
                        }
                        onClick={() => setSupplyDetail(row.id)}
                      />
                    ))}
                  {!form.values.materials.length && (
                    <Text size="sm" c="dimmed">
                      Was wird benötigt? Unbekannte Mengen und Preise kannst du zunächst
                      offenlassen.
                    </Text>
                  )}
                  {form.values.materials.map(
                    (row, index) =>
                      row.id === supplyDetail && (
                        <Paper withBorder p="md" key={row.id}>
                          <Stack gap="sm">
                            <Group wrap="nowrap" align="end">
                              <TextInput
                                label={'Material ' + (index + 1)}
                                required
                                maxLength={200}
                                value={row.title}
                                style={{ flex: 1, minWidth: 0 }}
                                onChange={(event) =>
                                  materialChange(index, { title: event.currentTarget.value })
                                }
                              />
                              <Tooltip label="Material entfernen">
                                <ActionIcon
                                  color="red"
                                  variant="subtle"
                                  aria-label={'Material ' + (index + 1) + ' entfernen'}
                                  onClick={() => {
                                    form.setFieldValue(
                                      'materials',
                                      form.values.materials.filter((r) => r.id !== row.id),
                                    );
                                    setSupplyDetail(null);
                                  }}
                                >
                                  <IconTrash size={17} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 3 }}>
                              <NumberInput
                                label="Menge"
                                min={0}
                                max={10000000}
                                decimalScale={3}
                                decimalSeparator=","
                                value={row.quantity ?? ''}
                                onChange={(value) =>
                                  materialChange(index, { quantity: numeric(value) })
                                }
                              />
                              <TextInput
                                label="Einheit"
                                placeholder="m², kg, Stück …"
                                maxLength={30}
                                value={row.unit}
                                onChange={(event) =>
                                  materialChange(index, { unit: event.currentTarget.value })
                                }
                              />
                              <NumberInput
                                label="Einzelpreis (€)"
                                min={0}
                                max={10000000}
                                decimalScale={2}
                                decimalSeparator=","
                                value={row.unit_price ?? ''}
                                onChange={(value) =>
                                  materialChange(index, { unit_price: numeric(value) })
                                }
                              />
                            </SimpleGrid>
                            <Select
                              label="Beschaffungsstatus"
                              data={['Benötigt', 'Bestellt', 'Vorhanden']}
                              value={row.status}
                              onChange={(value) =>
                                materialChange(index, { status: value || 'Benötigt' })
                              }
                            />
                            <Textarea
                              label="Materialhinweise"
                              autosize
                              minRows={2}
                              maxRows={5}
                              maxLength={2000}
                              value={row.notes}
                              onChange={(event) =>
                                materialChange(index, { notes: event.currentTarget.value })
                              }
                            />
                          </Stack>
                        </Paper>
                      ),
                  )}
                </ListFrame>
              </Tabs.Panel>
              <Tabs.Panel value="tools" pt="md">
                <ListFrame
                  title={supplyDetail ? 'Werkzeug bearbeiten' : 'Werkzeuge'}
                  backLabel="Zurück zur Werkzeugliste"
                  addLabel="Werkzeug hinzufügen"
                  onBack={supplyDetail ? () => setSupplyDetail(null) : undefined}
                  onAdd={addTool}
                  full={form.values.tools.length >= 100}
                >
                  {!supplyDetail &&
                    form.values.tools.map((row) => (
                      <SupplyRow
                        key={row.id}
                        title={row.title || 'Werkzeug ohne Bezeichnung'}
                        quantity={row.source}
                        cost={row.cost}
                        onClick={() => setSupplyDetail(row.id)}
                      />
                    ))}
                  {!form.values.tools.length && (
                    <Text size="sm" c="dimmed">
                      Sammle benötigte Werkzeuge und entscheide, wie du sie beschaffst.
                    </Text>
                  )}
                  {form.values.tools.map(
                    (row, index) =>
                      row.id === supplyDetail && (
                        <Paper withBorder p="md" key={row.id}>
                          <Stack gap="sm">
                            <Group wrap="nowrap" align="end">
                              <TextInput
                                label={'Werkzeug ' + (index + 1)}
                                required
                                maxLength={200}
                                value={row.title}
                                style={{ flex: 1, minWidth: 0 }}
                                onChange={(event) =>
                                  toolChange(index, { title: event.currentTarget.value })
                                }
                              />
                              <Tooltip label="Werkzeug entfernen">
                                <ActionIcon
                                  color="red"
                                  variant="subtle"
                                  aria-label={'Werkzeug ' + (index + 1) + ' entfernen'}
                                  onClick={() => {
                                    form.setFieldValue(
                                      'tools',
                                      form.values.tools.filter((r) => r.id !== row.id),
                                    );
                                    setSupplyDetail(null);
                                  }}
                                >
                                  <IconTrash size={17} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 2 }}>
                              <Select
                                label="Beschaffung"
                                data={['Noch offen', 'Vorhanden', 'Kaufen', 'Mieten', 'Ausleihen']}
                                value={row.source}
                                onChange={(value) =>
                                  toolChange(index, {
                                    source: value || 'Noch offen',
                                    ...(value === 'Vorhanden' ? { cost: 0 } : {}),
                                  })
                                }
                              />
                              <NumberInput
                                label="Geplante Kosten (€)"
                                min={0}
                                max={10000000}
                                decimalScale={2}
                                decimalSeparator=","
                                value={row.cost ?? ''}
                                onChange={(value) => toolChange(index, { cost: numeric(value) })}
                              />
                            </SimpleGrid>
                            <Checkbox
                              label="Werkzeug ist einsatzbereit"
                              checked={row.ready}
                              onChange={(event) =>
                                toolChange(index, { ready: event.currentTarget.checked })
                              }
                            />
                            <Textarea
                              label="Werkzeughinweise"
                              autosize
                              minRows={2}
                              maxRows={5}
                              maxLength={2000}
                              value={row.notes}
                              onChange={(event) =>
                                toolChange(index, { notes: event.currentTarget.value })
                              }
                            />
                          </Stack>
                        </Paper>
                      ),
                  )}
                </ListFrame>
              </Tabs.Panel>
            </Tabs>
            {(form.values.materials.length > 0 || form.values.tools.length > 0) && (
              <Text size="sm" c="dimmed">
                Bekannte Material- und Werkzeugkosten: <strong>{money(knownCosts)}</strong>. Offene
                Preise sind nicht enthalten.
              </Text>
            )}
            {ai.data?.sharing && (
              <Button
                variant="light"
                leftSection={<IconSparkles size={17} />}
                disabled={!form.values.title.trim()}
                onClick={() => {
                  try {
                    const selection = (window as any).PHBReactBridge.ai.selection();
                    setAIModel(selection.model);
                    setAIOpen(true);
                  } catch (error) {
                    setFailure(error);
                  }
                }}
              >
                Mit ChatGPT planen
              </Button>
            )}
            {!ai.data?.sharing && (
              <Text size="xs" c="dimmed">
                Mit einer ChatGPT-Verbindung kannst du optional einen Planvorschlag erarbeiten.
              </Text>
            )}
            <ErrorBox value={failure} />
            <ActionBar>
              {id && (
                <Group mr="auto" gap="xs">
                  <Tooltip label="Eigenleistung löschen">
                    <ActionIcon
                      aria-label="Eigenleistung löschen"
                      variant="subtle"
                      color="red"
                      onClick={() => void remove()}
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip
                    label={
                      form.values.archived ? 'Aus Archiv zurückholen' : 'Eigenleistung archivieren'
                    }
                  >
                    <ActionIcon
                      aria-label={
                        form.values.archived
                          ? 'Aus Archiv zurückholen'
                          : 'Eigenleistung archivieren'
                      }
                      variant="subtle"
                      onClick={() => void save(!form.values.archived)}
                    >
                      {form.values.archived ? (
                        <IconArchiveOff size={18} />
                      ) : (
                        <IconArchive size={18} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )}
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </ActionBar>
          </Stack>
        </form>
      </Editor>
      {invoicePlan && (
        <SelfWorkInvoices
          plan={invoicePlan}
          onClose={() => setInvoicePlanID(null)}
          onCreate={() => startReceiptUpload(invoicePlan.id)}
        />
      )}
      <SelfWorkAI
        opened={aiOpen}
        model={aiModel}
        context={{
          title: form.values.title,
          description: form.values.description,
          location: form.values.location,
          experience: form.values.experience,
          task_id: form.values.task_id,
        }}
        onClose={() => setAIOpen(false)}
        onApply={apply}
      />
    </div>
  );
}
