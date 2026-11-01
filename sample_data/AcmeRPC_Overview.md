# AcmeRPC Overview
Version: 2.1
Date: 2024-03-12

AcmeRPC is our internal high-performance remote procedure call framework. It uses Protocol Buffers for serialization and HTTP/2 for transport.

## Configuration
To connect to an AcmeRPC service, initialize the client with the service discovery URL:
`client = AcmeRPCClient(discovery_url="rpc.discovery.acmesys.internal")`

## Timeouts
By default, AcmeRPC calls time out after 5000ms. If you are querying a known slow service (like the legacy billing service), increase the timeout using the `timeout_ms` parameter in the request builder.
