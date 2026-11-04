/** Read contracts. Money is serialized as decimal-compatible JSON numbers at the API boundary. */
export type MoneyValue = number;
export type ProjectID = number;
export interface ProjectRecord {
  id: ProjectID;
  title: string;
  kind: string;
  description: string;
  archived: boolean;
  can_delete: boolean;
  tasks: number;
  completed: number;
  forecast: MoneyValue;
  open_todos: number;
}
export interface CompanyRecord {
  id: number;
  name: string;
  trade: string;
  contact: string;
  contact_secondary: string;
  email: string;
  phone: string;
  mobile: string;
  phone_other: string;
  website: string;
  address: string;
  notes: string;
}
export interface ReceiptRecord {
  id: number;
  supplier: string;
  invoice_number: string;
  document_date: string;
  due_date: string;
  status: 'Entwurf' | 'Gebucht' | 'Storniert';
  gross_amount: MoneyValue | null;
  paid_amount: MoneyValue;
  assignment_type: string;
}
export interface BuildPhaseRecord {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  completed: boolean;
}
export interface ProjectDocumentRecord {
  id: number;
  title: string;
  category: string;
  area: string;
  status: string;
  description: string;
  tags: string;
  original_name: string;
  extension: string;
  download_url: string;
  preview_url: string;
}
export interface WorkRecord {
  id: number;
  kind: 'todo' | 'note';
  title: string;
  body: string;
  due_on: string;
  done: boolean;
  archived: boolean;
  source_type: string;
  source_id: number | null;
}
export interface APIError {
  error: string;
  code?: 'edit_conflict' | 'operation_pending' | string;
  changes?: Record<string, { current: unknown; incoming: unknown }>;
}
export interface DocumentList {
  documents: ProjectDocumentRecord[];
}
export interface ProjectsResponse {
  projects: ProjectRecord[];
}
export interface ReferenceRecord {
  id: number;
  name: string;
  sort_order?: number;
}
export interface MasterDataResponse {
  companies: CompanyRecord[];
  trades: ReferenceRecord[];
  categories: ReferenceRecord[];
}
export interface FundingSelection {
  offer_id: number;
  position_ids: number[];
  eligible_cost: MoneyValue | null;
}
export interface ChecklistItem {
  key: string;
  title: string;
  status: 'present' | 'open' | 'confirm';
  detail: string;
  fields: string[];
  missing_fields: string[];
  missing_labels: string[];
  blocks_estimate: boolean;
}
export interface FundingReport {
  token: string;
  phase: 'orientation' | 'estimate';
  eligible: boolean | null;
  amount_min: MoneyValue | null;
  amount_max: MoneyValue | null;
  checked_on: string;
  explanation: string;
  questions: string[];
  missing: string[];
  assumptions: string[];
  sources: { title: string; url: string }[];
}
