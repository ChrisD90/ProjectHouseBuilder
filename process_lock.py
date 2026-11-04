"""Thread + OS-process lock for local restore/reset file operations on Mac/Linux."""
import json,os,tempfile
from pathlib import Path
from threading import Lock
import fcntl

class ProcessLock:
    def __init__(self,path):self.path=path;self.thread=Lock();self.file=None
    def acquire(self,blocking=True):
        if not self.thread.acquire(blocking=blocking):return False
        try:
            path=Path(self.path());path.parent.mkdir(parents=True,exist_ok=True)
            stream=path.open('a+')
            try:fcntl.flock(stream,fcntl.LOCK_EX|(0 if blocking else fcntl.LOCK_NB))
            except BlockingIOError:stream.close();self.thread.release();return False
            self.file=stream;return True
        except Exception:self.thread.release();raise
    def release(self):
        if self.file:
            fcntl.flock(self.file,fcntl.LOCK_UN);self.file.close();self.file=None
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
