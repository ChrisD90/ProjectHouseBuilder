export type Step = { id: string; title: string; notes: string; done: boolean };
export type Material = {
  id: string;
  title: string;
  notes: string;
  quantity: number | null;
  unit: string;
  unit_price: number | null;
  status: string;
};
export type Tool = {
  id: string;
  title: string;
  notes: string;
  source: string;
  cost: number | null;
  ready: boolean;
};
export type PlanDraft = {
  title: string;
  description: string;
  location: string;
  experience: string;
  status: string;
  task_id: number | null;
  steps: Step[];
  materials: Material[];
  tools: Tool[];
  notes: string;
  archived: boolean;
  receipt_ids: number[];
};
export type Plan = PlanDraft & {
  receipts: {
    id: number;
    label: string;
    status: string;
    amount: number;
    gross: number;
    paid: number;
    number: string;
    supplier: string;
    date: string;
    kind: string;
    billing_type: string;
  }[];
  id: number;
  task_label: string;
  task_missing: boolean;
  estimated_cost: number;
  actual_cost: number;
  procured_material_cost: number;
  costs_complete: boolean;
  updated_at: string;
};
export type Proposal = Pick<PlanDraft, 'steps' | 'materials' | 'tools'> & {
  summary: string;
  assumptions: string[];
};
export type PlanningContext = Pick<
  PlanDraft,
  'title' | 'description' | 'location' | 'experience' | 'task_id'
>;
export const newID = () =>
  crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
export const emptyPlan = (): PlanDraft => ({
  title: '',
  description: '',
  location: '',
  experience: 'Einsteiger',
  status: 'Geplant',
  task_id: null,
  steps: [],
  materials: [],
  tools: [],
  notes: '',
  archived: false,
  receipt_ids: [],
});
export function draftOf(plan: Plan): PlanDraft {
  const draft = emptyPlan();
  for (const key of Object.keys(draft) as (keyof PlanDraft)[])
    (draft as Record<string, unknown>)[key] = plan[key];
  return JSON.parse(JSON.stringify(draft));
}
