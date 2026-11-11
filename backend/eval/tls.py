"""Use certifi's CA bundle for TLS when it is installed.

The Windows certificate store can lack the root CA that Neo4j Aura uses, which makes local scripts
fail with "Unable to retrieve routing information". Import this before graph.connection.
"""
import os

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass
