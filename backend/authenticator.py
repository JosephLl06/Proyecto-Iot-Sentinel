"""Segundo factor local compatible con aplicaciones TOTP."""
import base64
import hashlib
import hmac
import secrets
import time
from io import BytesIO

import pyotp
import qrcode
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ISSUER = "IoTSentinel"
AAD = b"IoTSentinel/TOTP/v1"


def credential_key(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)


def pair(email, secret):
    uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)
    image = BytesIO()
    from qrcode.image.pure import PyPNGImage
    qrcode.make(uri, image_factory=PyPNGImage, box_size=5).save(image)
    return "data:image/png;base64," + base64.b64encode(image.getvalue()).decode("ascii")


def seal(secret, key):
    nonce = secrets.token_bytes(12)
    return (nonce + AESGCM(key).encrypt(nonce, secret.encode("ascii"), AAD)).hex()


def unseal(value, key):
    data = bytes.fromhex(value)
    return AESGCM(key).decrypt(data[:12], data[12:], AAD).decode("ascii")


def valid_step(secret, code, last_used=-1):
    if len(code) != 6 or not code.isascii() or not code.isdigit():
        return None
    current = int(time.time()) // 30
    generator = pyotp.TOTP(secret)
    for step in (current, current - 1, current + 1):
        if step > last_used and hmac.compare_digest(generator.generate_otp(step), code):
            return step
    return None


def recovery_hash(code):
    normalized = code.replace("-", "").strip().upper()
    return hashlib.sha256(normalized.encode()).hexdigest()


def recovery_codes():
    codes = []
    for _ in range(8):
        code = secrets.token_hex(8).upper()
        codes.append("-".join(code[offset:offset + 4] for offset in range(0, 16, 4)))
    return codes
