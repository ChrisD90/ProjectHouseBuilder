"""Manual offer payment completion; never infer it from invoice amounts."""
from alembic import op
import sqlalchemy as sa
revision='0047'
down_revision='0046'
branch_labels=None
depends_on=None

def upgrade():
    if 'payment_completed' not in {c['name'] for c in sa.inspect(op.get_bind()).get_columns('offer')}:
        op.add_column('offer',sa.Column('payment_completed',sa.Boolean(),nullable=False,server_default=sa.false()))

def downgrade():raise RuntimeError('Bitte ein geprüftes Projektbackup wiederherstellen.')
