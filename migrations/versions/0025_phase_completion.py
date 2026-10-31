"""Record explicit phase completion dates."""
from alembic import op
import sqlalchemy as sa
revision='0025'
down_revision='0024'
branch_labels=None
depends_on=None

def upgrade():
    inspector=sa.inspect(op.get_bind())
    if inspector.has_table('build_phase') and 'completed_at' not in {c['name'] for c in inspector.get_columns('build_phase')}:
        op.add_column('build_phase',sa.Column('completed_at',sa.Date(),nullable=True))

def downgrade():
    with op.batch_alter_table('build_phase') as batch:
        batch.drop_column('completed_at')
