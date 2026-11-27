"""Receptor de demostración para dos equipos, con certificados de cliente y servidor."""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def identity(directory, role, ip=None):
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    keyfile, certfile = directory / (role + ".key"), directory / (role + ".crt")
    if keyfile.exists() or certfile.exists():
        raise ValueError("La identidad ya existe. Conserva sus archivos o elige otra carpeta.")
    key = ec.generate_private_key(ec.SECP256R1())
    now = dt.datetime.now(dt.timezone.utc)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "IoTSentinel CR3 " + role)])
    ski = x509.SubjectKeyIdentifier.from_public_key(key.public_key())
    builder = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
               .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
               .not_valid_after(now + dt.timedelta(days=7)).add_extension(ski, False)
               .add_extension(x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(ski), False)
               .add_extension(x509.BasicConstraints(False, None), True)
               .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), True)
               .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH if ip else ExtendedKeyUsageOID.CLIENT_AUTH]), False))
    if ip:
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.IPv4Address(ip))]), False)
    cert = builder.sign(key, hashes.SHA256())
    with os.fdopen(os.open(keyfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        out.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    with certfile.open("xb") as out:
        out.write(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Certificado público {certfile} · SHA256 {cert.fingerprint(hashes.SHA256()).hex()}", flush=True)


class Receipt(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/lecturas":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 65536:
                raise ValueError()
            raw = self.rfile.read(length)
            batch = json.loads(raw)
            if not isinstance(batch["readings"], list) or not isinstance(batch["timestamp"], int):
                raise ValueError()
            cpu = int(batch["procesoCpuMs"])
        except (TypeError, KeyError, ValueError, RecursionError):
            self.send_error(400)
            return
        print(f"origen={self.client_address[0]} tls={self.connection.version()} lote={batch['timestamp']} "
              f"lecturas={len(batch['readings'])} cuerpo={len(raw)}B cpu_gateway={cpu}ms "
              f"sha256={hashlib.sha256(raw).hexdigest()[:16]}", flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_):
        pass


class Receiver(ThreadingHTTPServer):
    def process_request_thread(self, request, address):
        try:
            request.do_handshake()
        except OSError:
            print("Conexión TLS rechazada antes de recibir telemetría.", flush=True)
            self.shutdown_request(request)
            return
        super().process_request_thread(request, address)

    def get_request(self):
        stream, peer = super().get_request()
        stream.settimeout(5)
        return self.context.wrap_socket(stream, server_side=True, do_handshake_on_connect=False), peer


def receiver_context(folder):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.load_cert_chain(folder / "receptor.crt", folder / "receptor.key")
    context.load_verify_locations(cafile=folder / "gateway.crt")
    context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    context.verify_mode = ssl.CERT_REQUIRED
    return context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    init = sub.add_parser("identidad")
    init.add_argument("rol", choices=["gateway", "receptor"])
    init.add_argument("--ip")
    listen = sub.add_parser("escuchar")
    listen.add_argument("--ip", required=True)
    listen.add_argument("--puerto", type=int, default=9443)
    for item in (init, listen):
        item.add_argument("--carpeta", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "identidad":
        if (args.rol == "receptor") != bool(args.ip):
            parser.error("Indica --ip solo para el certificado del receptor.")
        identity(args.carpeta, args.rol, args.ip)
        return
    ip = ipaddress.IPv4Address(args.ip)
    if ip.is_unspecified or ip.is_multicast or not ip.is_private:
        parser.error("Elige la IPv4 privada específica de la interfaz de laboratorio.")
    folder = args.carpeta
    context = receiver_context(folder)
    with Receiver((str(ip), args.puerto), Receipt) as server:
        server.context = context
        print(f"Escuchando en https://{ip}:{server.server_port}/lecturas · TLS 1.3 mutuo", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
