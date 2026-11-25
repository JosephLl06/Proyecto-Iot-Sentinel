"""Identidad HTTPS local. La clave de la CA se descarta tras firmar el certificado."""
import ipaddress
import os
import ssl
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

LOOPBACK = ipaddress.IPv4Address("127.0.0.1")


def private_file(path, data):
    temporary = path.with_suffix(".new")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(data)
    temporary.replace(path)


def create_identity(folder):
    today = datetime.now(timezone.utc)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    server_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "IoTSentinel Local")])
    server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, str(LOOPBACK))])
    ca_id = x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key())

    def builder(subject, key):
        return (x509.CertificateBuilder().subject_name(subject).issuer_name(ca_name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(today - timedelta(days=1))
                .not_valid_after(today + timedelta(days=365))
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(ca_id), False))

    def usage(ca):
        return x509.KeyUsage(not ca, False, False, False, False, ca, ca, False, False)

    ca = (builder(ca_name, ca_key).add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
          .add_extension(ca_id, False).add_extension(usage(True), True)
          .add_extension(x509.NameConstraints(
              permitted_subtrees=[x509.IPAddress(ipaddress.ip_network("127.0.0.1/32"))],
              excluded_subtrees=[x509.DNSName(".")],
          ), True).sign(ca_key, hashes.SHA256()))
    server = (builder(server_name, server_key).add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(server_key.public_key()), False)
              .add_extension(x509.SubjectAlternativeName([x509.IPAddress(LOOPBACK)]), False)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), False)
              .add_extension(usage(False), True).sign(ca_key, hashes.SHA256()))

    # Escribir la raíz al final marca que los tres archivos se crearon.
    private_file(folder / "panel-key.pem", server_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    private_file(folder / "panel.pem", server.public_bytes(serialization.Encoding.PEM))
    private_file(folder / "iotsentinel-local.crt", ca.public_bytes(serialization.Encoding.PEM))


def panel_identity(data_dir):
    folder = Path(data_dir) / "https"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    root = folder / "iotsentinel-local.crt"
    if not root.exists():
        create_identity(folder)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.set_alpn_protocols(["http/1.1"])
    context.load_cert_chain(folder / "panel.pem", folder / "panel-key.pem")
    ca = x509.load_pem_x509_certificate(root.read_bytes())
    if ca.not_valid_after_utc <= datetime.now(timezone.utc):
        raise ValueError("El certificado local venció. Consulta la sección HTTPS del README.")
    return context, root, ca


def windows_trust(root, cert):
    # Python consulta los certificados raíz de Windows al crear un contexto cliente.
    if cert.public_bytes(serialization.Encoding.DER) in ssl.create_default_context().get_ca_certs(binary_form=True):
        return True
    print(f"Certificado HTTPS local: {root}", flush=True)
    print(f"Huella SHA-256: {cert.fingerprint(hashes.SHA256()).hex()}", flush=True)
    if not sys.stdin.isatty() or input("¿Confiar en el certificado local para tu usuario de Windows? [s/N] ").strip().lower() != "s":
        return False
    certutil = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "certutil.exe"
    return subprocess.run([str(certutil), "-user", "-addstore", "Root", str(root)], check=False).returncode == 0
