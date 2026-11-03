"""Thread + OS-process lock for local restore/reset operations, including Windows."""
import json,os,tempfile
from pathlib import Path
from threading import Lock
import errno,time
if os.name=='nt':
    import msvcrt
else:
    import fcntl

def _lock(stream,blocking):
    if os.name!='nt':
        fcntl.flock(stream,fcntl.LOCK_EX|(0 if blocking else fcntl.LOCK_NB));return
    stream.seek(0,2)
    if stream.tell()==0:stream.write(b'\0');stream.flush()
    while True:
        stream.seek(0)
        try:msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1);return
        except OSError as exc:
            if exc.errno not in (errno.EACCES,errno.EAGAIN,errno.EDEADLK):raise
            if not blocking:raise BlockingIOError() from exc
            time.sleep(.05)

def _unlock(stream):
    if os.name=='nt':stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
    else:fcntl.flock(stream,fcntl.LOCK_UN)

class ProcessLock:
    def __init__(self,path):self.path=path;self.thread=Lock();self.file=None
    def acquire(self,blocking=True):
        if not self.thread.acquire(blocking=blocking):return False
        try:
            path=Path(self.path());path.parent.mkdir(parents=True,exist_ok=True)
            stream=path.open('a+b')
            try:_lock(stream,blocking)
            except BlockingIOError:stream.close();self.thread.release();return False
            except Exception:stream.close();raise
            self.file=stream;return True
        except Exception:self.thread.release();raise
    def release(self):
        if self.file:
            try:_unlock(self.file)
            finally:self.file.close();self.file=None
        self.thread.release()
    def locked(self):
        if self.thread.locked():return True
        if not self.acquire(blocking=False):return True
        self.release();return False
    def __enter__(self):self.acquire();return self
    def __exit__(self,*args):self.release()

def write_state(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(dir=path.parent,prefix='.restore-status-')
    try:
        with os.fdopen(fd,'w') as out:json.dump(value,out,ensure_ascii=False,default=str)
        os.chmod(temporary,0o600);os.replace(temporary,path)
    finally:Path(temporary).unlink(missing_ok=True)

def read_state(path,fallback):
    try:
        value=json.loads(Path(path).read_text());return value if isinstance(value,dict) else fallback
    except (OSError,ValueError):return fallback
