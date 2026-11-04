"""Explicit exclusive receipt assignments: accepted offer, contractor or own work.

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('receipt'):
        return
    columns = {col['name'] for col in inspector.get_columns('receipt')}
    if 'assignment_type' not in columns:
        op.add_column('receipt', sa.Column(
            'assignment_type', sa.String(24), nullable=False, server_default=''))
    if 'contractor_id' not in columns:
        op.add_column('receipt', sa.Column(
            'contractor_id', sa.Integer(), sa.ForeignKey('contractor.id'), nullable=True))
    # Keep existing cost-item links and booked totals intact; never infer own work.
    op.execute(sa.text("""
        UPDATE receipt SET assignment_type =
          CASE
            WHEN cost_item_id IS NULL THEN ''
            WHEN EXISTS (
                SELECT 1 FROM cost_item ci
                WHERE ci.id = receipt.cost_item_id AND ci.offer_id IS NOT NULL
            ) THEN 'Angebot'
            ELSE 'Kostenposition'
          END
        WHERE assignment_type = ''
    """))


def downgrade():
    raise RuntimeError('Bitte ein geprüftes Komplettbackup wiederherstellen.')
