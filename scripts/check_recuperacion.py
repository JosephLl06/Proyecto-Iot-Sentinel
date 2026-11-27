"""Verifica el cambio de contraseña, vigencia del segundo factor y revocación."""
from pathlib import Path
import secrets
import tempfile
import time

import pyotp
from main import Gateway


def main():
    with tempfile.TemporaryDirectory() as tmp:
        gateway = Gateway(Path(tmp))
        email = "prueba@example.test"
        old, new = (secrets.token_urlsafe(20) for _ in range(2))
        try:
            token, start = gateway.login({"email": email, "password": old})
            otp = pyotp.TOTP(start["manualKey"])
            now = int(time.time() // 30)
            session, issued = gateway.verify_factor(token, {"code": otp.generate_otp(now - 1)})
            payload = {"email": email, "password": new, "code": otp.generate_otp(now),
                       "recovery": issued["passwordRecoveryKey"]}
            assert not gateway.reset_password(dict(payload, recovery="0" * 64))
            assert not gateway.reset_password(dict(payload, code=otp.generate_otp(now - 1)))
            assert gateway.reset_password(payload)
            assert gateway.session_user(session) is None
            assert gateway.login({"email": email, "password": old}) is None
            assert not gateway.reset_password(payload)
            token, pending = gateway.login({"email": email, "password": new})
            assert pending["stage"] == "verify"
            assert gateway.verify_factor(token, {"code":issued["recoveryCodes"][0]}) is None
            _, saved = gateway.verify_factor(token, {"code":otp.generate_otp(now + 1)})
            assert len(saved["recoveryCodes"]) == 8 and saved["passwordRecoveryKey"] != payload["recovery"]
            print("OK: cambio de contraseña, rechazo de clave falsa y código reutilizado, revocación de sesión y respaldos, renovación tras el nuevo acceso.")
        finally:
            gateway.store.db.close()


if __name__ == "__main__":
    main()
