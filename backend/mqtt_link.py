import asyncio
from base64 import b64decode, b64encode
import ipaddress
import json
import os
import ssl
import socket
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from amqtt.broker import Broker
from amqtt.client import MQTTClient
from amqtt.contexts import Action, BrokerConfig, ClientConfig, ConnectionConfig, ListenerConfig
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, x25519
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

ENVELOPE_VERSION = b"IS1"
TOPIC = "iotsentinel/simulated/telemetry"


class LocalBroker(Broker):
    async def _authenticate(self, session, listener):
        peer = session.ssl_object.getpeercert() if session.ssl_object else None
        subject = (peer or {}).get("subject", ())
        role = next((value for group in subject for key, value in group if key == "commonName"), None)
        if role not in {"gateway", "simulator"} or role != session.client_id:
            return False
        session.username = role
        return session.clean_session and not session.will_flag

    async def _topic_filtering(self, session, topic, action):
        if topic != TOPIC or session is None:
            return False
        if action == Action.PUBLISH:
            return session.username == "simulator"
        return session.username == "gateway" and action in {Action.SUBSCRIBE, Action.RECEIVE}

    async def _create_server_instance(self, *args):
        server = await super()._create_server_instance(*args)
        self.port = server.sockets[0].getsockname()[1]
        return server


def local_identity(directory):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "IoTSentinel local")])
    today = datetime.now(timezone.utc)
    subject_key = x509.SubjectKeyIdentifier.from_public_key(key.public_key())
    usage = x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                          data_encipherment=False, key_agreement=False, key_cert_sign=True,
                          crl_sign=True, encipher_only=False, decipher_only=False)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(today - timedelta(minutes=5)).not_valid_after(today + timedelta(days=7))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(usage, critical=True)
            .add_extension(subject_key, critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(subject_key), False)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
            .sign(key, hashes.SHA256()))
    cert_path = Path(directory) / "cert.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    identities = {}
    for role in ("broker", "gateway", "simulator"):
        leaf_key = ec.generate_private_key(ec.SECP256R1())
        leaf_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, role)])
        purpose = ExtendedKeyUsageOID.SERVER_AUTH if role == "broker" else ExtendedKeyUsageOID.CLIENT_AUTH
        builder = (x509.CertificateBuilder().subject_name(leaf_name).issuer_name(name)
                   .public_key(leaf_key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(today - timedelta(minutes=5)).not_valid_after(today + timedelta(days=2))
                   .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                   .add_extension(x509.AuthorityKeyIdentifier.from_issuer_subject_key_identifier(subject_key), False)
                   .add_extension(x509.ExtendedKeyUsage([purpose]), False))
        if role == "broker":
            builder = builder.add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
        leaf = builder.sign(key, hashes.SHA256())
        cert_file = Path(directory) / f"{role}.crt"
        key_file = Path(directory) / f"{role}.key"
        cert_file.write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
        with os.fdopen(os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
            output.write(leaf_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                serialization.NoEncryption()))
        identities[role] = str(cert_file), str(key_file)
    return str(cert_path), identities


class MosquittoBroker:
    async def start(self, executable, directory, ca, client):
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            self.port = port_socket.getsockname()[1]
        folder = Path(directory)
        (folder / "access.acl").write_text(
            f"user simulator\ntopic write {TOPIC}\nuser gateway\ntopic read {TOPIC}\n", encoding="utf-8")
        (folder / "access.acl").chmod(0o600)
        (folder / "broker.conf").write_text(
            f"listener {self.port} 127.0.0.1\nprotocol mqtt\ncafile cert.pem\ncertfile broker.crt\n"
            "keyfile broker.key\ntls_version tlsv1.3\nrequire_certificate true\nuse_identity_as_username true\n"
            "allow_anonymous false\nacl_file access.acl\npersistence false\n", encoding="utf-8")
        self.process = await asyncio.create_subprocess_exec(executable, "-c", "broker.conf", cwd=directory)
        context = ssl.create_default_context(cafile=ca)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.load_cert_chain(*client)
        try:
            async with asyncio.timeout(6):
                while self.process.returncode is None:
                    try:
                        _, writer = await asyncio.open_connection("127.0.0.1", self.port, ssl=context)
                    except ConnectionRefusedError:
                        await asyncio.sleep(0.1)
                        continue
                    writer.close()
                    await writer.wait_closed()
                    return
                raise RuntimeError("Mosquitto terminó antes de aceptar la conexión segura.")
        except BaseException:
            await self.shutdown()
            raise

    async def shutdown(self):
        if self.process.returncode is None:
            self.process.terminate()
            await self.process.wait()


def derive(secret, salt, device_id):
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=b"IoTS-KEX/v1/IoTS-Crypt/ChaCha20Poly1305/" + device_id.encode()).derive(secret)
    return ChaCha20Poly1305(key)


class Telemetry:
    async def start(self, directory, mosquitto=None):
        cert, identities = local_identity(directory)
        if mosquitto:
            exe = shutil.which(mosquitto)
            if not exe:
                raise ValueError("No se encontró el ejecutable de Mosquitto indicado.")
            self.broker = MosquittoBroker()
            await self.broker.start(str(Path(exe).resolve()), directory, cert, identities["gateway"])
        else:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_3
            context.load_cert_chain(*identities["broker"])
            context.load_verify_locations(cert)
            context.verify_mode = ssl.CERT_REQUIRED
            listener = ListenerConfig(bind="127.0.0.1:0", ssl=True, ssl_context=context, max_connections=2)
            self.broker = LocalBroker(BrokerConfig(
                listeners={"default": listener},
                plugins={},
            ))
            await self.broker.start()
        def client(role):
            certfile, keyfile = identities[role]
            return MQTTClient(client_id=role, config=ClientConfig(connection=ConnectionConfig(certfile=certfile, keyfile=keyfile)))
        self.gateway = client("gateway")
        self.simulator = client("simulator")
        uri = f"mqtts://127.0.0.1:{self.broker.port}"
        try:
            await self.gateway.connect(uri, cafile=cert)
            await self.simulator.connect(uri, cafile=cert)
            await self.gateway.subscribe([(TOPIC, 1)])
        except BaseException:
            await self.broker.shutdown()
            raise

        self.gateway_key = x25519.X25519PrivateKey.generate()
        self.sender_keys = {}
        self.receiver_keys = {}

    def register(self, device_id):
        if device_id in self.sender_keys:
            return
        device_key = x25519.X25519PrivateKey.generate()
        salt = os.urandom(32)
        self.sender_keys[device_id] = derive(device_key.exchange(self.gateway_key.public_key()), salt, device_id)
        self.receiver_keys[device_id] = derive(self.gateway_key.exchange(device_key.public_key()), salt, device_id)

    async def exchange(self, samples, *, evidence=None):
        batch = ENVELOPE_VERSION + os.urandom(16)
        envelopes = {}
        for sample in samples:
            device_id = sample["id"]
            self.register(device_id)
            nonce = os.urandom(12)
            aad = batch + TOPIC.encode() + device_id.encode()
            ciphertext = self.sender_keys[device_id].encrypt(nonce, json.dumps(sample).encode(), aad)
            envelopes[device_id] = b64encode(nonce + ciphertext).decode("ascii")
        await self.simulator.publish(TOPIC, batch + json.dumps(envelopes).encode(), qos=1, ack_timeout=3)
        async with asyncio.timeout(4):
            while True:
                message = await self.gateway.deliver_message()
                data = message.data
                if message.topic == TOPIC and data.startswith(batch):
                    break

        decoded = json.loads(data[len(batch):])
        if not isinstance(decoded, dict) or decoded.keys() != envelopes.keys():
            raise ValueError("Telemetría incompleta o de un dispositivo no registrado en este ciclo.")
        readings = []
        for device_id, value in decoded.items():
            encrypted = b64decode(value, validate=True)
            aad = batch + TOPIC.encode() + device_id.encode()
            sample = json.loads(self.receiver_keys[device_id].decrypt(encrypted[:12], encrypted[12:], aad))
            if sample["id"] != device_id:
                raise ValueError("La identidad de la lectura no coincide.")
            if evidence is not None:
                evidence(value, sample)
            readings.append(sample)
        return readings

    async def close(self):
        await asyncio.gather(self.gateway.disconnect(), self.simulator.disconnect(), return_exceptions=True)
        await self.broker.shutdown()
