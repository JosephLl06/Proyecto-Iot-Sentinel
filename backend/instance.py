"""Impide que dos instancias modifiquen la misma base de datos."""
import os
from contextlib import contextmanager


@contextmanager
def app_instance(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "session.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"1")
            lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise SystemExit("IoTSentinel ya está abierto con esta carpeta de datos.") from error
        # Cerrar el descriptor libera el bloqueo, incluso si se cierra el proceso.
        yield
