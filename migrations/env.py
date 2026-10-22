"""Alembic environment for ProjectHouseBuilder (offline SQL unsupported)."""
from alembic import context
from sqlalchemy import engine_from_config, pool
from app import db

config = context.config
target_metadata = db.metadata


def run_migrations_online():
    connectable = engine_from_config(config.get_section(config.config_ini_section), prefix='sqlalchemy.', poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                          render_as_batch=connection.dialect.name == 'sqlite', transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError('Offline schema migrations are not supported')
run_migrations_online()
