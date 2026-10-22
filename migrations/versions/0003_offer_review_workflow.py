"""Separate PDF offer review, list and acceptance; retain historical offers.

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {col['name'] for col in sa.inspect(bind).get_columns('offer')}
    if 'category' not in columns:
        op.add_column('offer', sa.Column('category', sa.String(120), nullable=False,
                                        server_default='Sonstiges'))
    if 'budget_line_id' not in columns:
        op.add_column('offer', sa.Column('budget_line_id', sa.Integer, nullable=True))
    if 'notes' not in columns:
        op.add_column('offer', sa.Column('notes', sa.Text, nullable=False,
                                        server_default=''))
    # Existing accepted orders remain untouched. Only previously selected, unpaid
    # quote sections lose their old *forecast selection*; values remain in the DB.
    # This corrects old pre-acceptance forecast impacts without deleting records.
    cost_columns={col['name'] for col in sa.inspect(bind).get_columns('cost_item')}
    if {'offer_id','selected','state','paid','committed'} <= cost_columns:
        op.execute(sa.text("""UPDATE cost_item SET selected=0, state='Alternative'
            WHERE offer_id IN (SELECT id FROM offer WHERE status='Angebot')
              AND COALESCE(paid,0)=0 AND COALESCE(committed,0)=0
              AND state='Angebot'"""))



def downgrade():
    raise RuntimeError('Downgrade nicht unterstützt. Bitte ein vollständiges Backup wiederherstellen.')
