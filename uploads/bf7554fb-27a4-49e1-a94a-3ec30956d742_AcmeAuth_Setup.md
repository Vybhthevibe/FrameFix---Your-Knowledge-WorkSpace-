# AcmeAuth Integration Guide
Version: 1.5
Date: 2025-01-20

AcmeAuth handles all internal SSO (Single Sign-On). 

## Setup
To authenticate with AcmeAuth from a Python microservice, you must use the `acme-auth-sdk`.

1. Install the SDK.
2. Initialize it with your service credentials.

```python
from acme_auth import AcmeAuthenticator

authenticator = AcmeAuthenticator(
    client_id=os.environ["ACME_CLIENT_ID"],
    client_secret=os.environ["ACME_CLIENT_SECRET"]
)

token = authenticator.get_service_token()
```

## Token Expiry
Tokens expire every 60 minutes. The SDK handles automatic refreshing if you use `authenticator.get_client()`. Do not cache the raw string token globally.
