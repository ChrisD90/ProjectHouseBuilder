"""Independent trade assignment for receipts."""
from alembic import op
import sqlalchemy as sa
revision='0024'
down_revision='0023'
branch_labels=None
depends_on=None

def upgrade():
    inspector=sa.inspect(op.get_bind())
    if not inspector.has_table('receipt'):return
    columns={c['name'] for c in inspector.get_columns('receipt')}
    if 'trade' not in columns:
        op.add_column('receipt',sa.Column('trade',sa.String(120),nullable=False,server_default=''))

def downgrade():
    with op.batch_alter_table('receipt') as batch:
        batch.drop_column('trade')
