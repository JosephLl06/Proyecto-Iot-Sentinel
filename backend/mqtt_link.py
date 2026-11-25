import asyncio
import ipaddress
import json
import os
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path

from amqtt.broker import Broker
from amqtt.client import MQTTClient
from amqtt.contexts import BrokerConfig, ClientConfig, ConnectionConfig, ListenerConfig
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, x25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.x509.oid import NameOID

TOPIC = "iotsentinel/simulated/telemetry"


class LocalBroker(Broker):
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
    key_path = Path(directory) / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    with os.fdopen(os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                       serialization.NoEncryption()))
    return str(cert_path), str(key_path)


def derive(secret, salt):
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=b"IoTSentinel/telemetry/v1").derive(secret)
    return AESGCM(key)


class Telemetry:
    async def start(self, directory):
        cert, key = local_identity(directory)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.load_cert_chain(cert, key)
        context.load_verify_locations(cert)
        context.verify_mode = ssl.CERT_REQUIRED
        listener = ListenerConfig(bind="127.0.0.1:0", ssl=True, ssl_context=context, max_connections=2)
        self.broker = LocalBroker(BrokerConfig(
            listeners={"default": listener},
            plugins={"amqtt.plugins.authentication.AnonymousAuthPlugin": {"allow_anonymous": True}},
        ))
        await self.broker.start()
        config = ClientConfig(connection=ConnectionConfig(certfile=cert, keyfile=key))
        self.gateway = MQTTClient(config=config)
        self.simulator = MQTTClient(config=config)
        uri = f"mqtts://127.0.0.1:{self.broker.port}"
        await self.gateway.connect(uri, cafile=cert)
        await self.simulator.connect(uri, cafile=cert)
        await self.gateway.subscribe([(TOPIC, 1)])

        # El aprovisionamiento local vincula los dos roles dentro del mismo proceso.
        sender_key = x25519.X25519PrivateKey.generate()
        receiver_key = x25519.X25519PrivateKey.generate()
        salt = os.urandom(32)
        self.sender = derive(sender_key.exchange(receiver_key.public_key()), salt)
        self.receiver = derive(receiver_key.exchange(sender_key.public_key()), salt)

    async def exchange(self, samples):
        batch = os.urandom(16)
        nonce = os.urandom(12)
        aad = TOPIC.encode() + batch
        payload = json.dumps(samples).encode()
        ciphertext = self.sender.encrypt(nonce, payload, aad)
        await self.simulator.publish(TOPIC, batch + nonce + ciphertext, qos=1, ack_timeout=3)
        async with asyncio.timeout(4):
            while True:
                message = await self.gateway.deliver_message()
                data = message.data
                if message.topic == TOPIC and data[:16] == batch:
                    return json.loads(self.receiver.decrypt(data[16:28], data[28:], aad))

    async def close(self):
        await asyncio.gather(self.gateway.disconnect(), self.simulator.disconnect(), return_exceptions=True)
        await self.broker.shutdown()
