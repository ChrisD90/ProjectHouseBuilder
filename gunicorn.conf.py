"""Start durable queue polling after fork, never in the Gunicorn master."""
def post_worker_init(worker):
    from app import app,_ensure_import_recovery
    with app.app_context():_ensure_import_recovery()
