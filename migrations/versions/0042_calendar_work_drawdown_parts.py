"""Preserve legacy work rules and drawdown history while adding opt-in workflows."""
from alembic import op
import sqlalchemy as sa
revision='0042'
down_revision='0041'
branch_labels=None
depends_on=None

def upgrade():
    connection=op.get_bind()
    for table,column in [('calendar_preferences','work_json'),('finance_loan_drawdown','payouts_json')]:
        if column not in {c['name'] for c in sa.inspect(connection).get_columns(table)}:
            op.add_column(table,sa.Column(column,sa.Text(),nullable=False,server_default='{}' if column=='work_json' else '[]'))

    if 'calendar_event_id' not in {c['name'] for c in sa.inspect(connection).get_columns('self_work_plan')}:
        op.add_column('self_work_plan',sa.Column('calendar_event_id',sa.Integer(),nullable=True))

def downgrade():
    raise RuntimeError('Bitte ein geprüftes Backup wiederherstellen.')
