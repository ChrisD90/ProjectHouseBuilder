"""Durable operation receipts, job leases and decimal legacy money storage."""
from alembic import op
revision='0031'
down_revision='0030'
branch_labels=None
depends_on=None

def upgrade():
    from request_safety import ensure_schema
    from job_leases import ensure_schema as ensure_jobs
    from money_values import migrate_money
    connection=op.get_bind()
    ensure_schema(connection);ensure_jobs(connection);migrate_money(connection)

def downgrade():raise RuntimeError('Bitte ein geprüftes vollständiges Backup wiederherstellen.')
