import { Button } from '@mantine/core';
import { ReceiptOverview } from './receipt-overview';
import type { Plan } from './self-work-types';

export function SelfWorkInvoices({
  plan,
  onClose,
  onCreate,
}: {
  plan: Plan;
  onClose: () => void;
  onCreate: () => void;
}) {
  const paid = plan.receipts
    .filter((r) => r.status === 'Gebucht')
    .reduce((sum, r) => sum + r.paid, 0);
  return (
    <ReceiptOverview
      title={'Rechnungen · ' + plan.title}
      receipts={plan.receipts}
      summary={[
        ['Planwert', plan.estimated_cost],
        ['Gebucht', plan.actual_cost],
        ['Bezahlt', paid],
        ['Rest', Math.max(plan.estimated_cost, plan.actual_cost) - paid],
      ]}
      emptyText="Dieser Eigenleistung sind noch keine Rechnungen zugeordnet."
      onClose={onClose}
      footer={<Button onClick={onCreate}>Neue Rechnung zuordnen</Button>}
    />
  );
}
