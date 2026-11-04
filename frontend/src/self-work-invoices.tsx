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
  return (
    <ReceiptOverview
      title={'Rechnungen · ' + plan.title}
      receipts={plan.receipts}
      emptyText="Dieser Eigenleistung sind noch keine Rechnungen zugeordnet."
      onClose={onClose}
      footer={<Button onClick={onCreate}>Neue Rechnung zuordnen</Button>}
    />
  );
}
