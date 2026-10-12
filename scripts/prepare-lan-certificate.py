"""Create one local server certificate. Private material stays in AIRI .local."""

import datetime
import ipaddress
import json
import pathlib
import secrets
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

workspace = pathlib.Path(__file__).resolve().parent.parent
folder = workspace / 'airi' / '.local' / 'lan'
public = workspace / '.runtime' / 'lan'
folder.mkdir(parents=True, exist_ok=True)
public.mkdir(parents=True, exist_ok=True)
host = str(ipaddress.IPv4Address(sys.argv[1]))
config_path = folder / 'config.json'
if config_path.exists():
    config = json.loads(config_path.read_text(encoding='utf-8'))
    if config['host'] != host:
        raise SystemExit('LAN IP changed. Preserve the old certificate before creating another.')
else:
    now = datetime.datetime.now(datetime.timezone.utc)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'AIRI LAN ' + host)])
    certificate = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=180))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(host))]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=True,
                                   content_commitment=False, data_encipherment=False,
                                   key_agreement=False, key_cert_sign=False, crl_sign=False,
                                   encipher_only=None, decipher_only=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    (folder / 'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (folder / 'server.pem').write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    (public / 'airi-lan.cer').write_bytes(certificate.public_bytes(serialization.Encoding.DER))
    config = {'host': host, 'port': 5443, 'setupPort': 5442, 'access': secrets.token_urlsafe(32)}
    config_path.write_text(json.dumps(config), encoding='utf-8')
certificate = x509.load_pem_x509_certificate((folder / 'server.pem').read_bytes())
print('Certificate SHA256: ' + certificate.fingerprint(hashes.SHA256()).hex())
print('Certificate ready for ' + host)
