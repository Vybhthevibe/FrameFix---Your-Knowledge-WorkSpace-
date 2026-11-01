# Incident Report: INC-402
Date: 2025-06-15
Service: User Profile Service

## Description
The User Profile Service experienced a 45-minute outage, returning HTTP 503 Service Unavailable to all callers.

## Root Cause
The service uses AcmeRPC to fetch user permissions from the Authorization service. A misconfiguration in the Authorization service caused it to respond slowly (avg response time > 6000ms). Because the User Profile Service used the default AcmeRPC timeout of 5000ms, all calls timed out, and the connection pool was exhausted.

## Resolution
The immediate fix was to scale up the Authorization service.
Long-term fix: Implemented circuit breakers in the User Profile Service and increased the AcmeRPC timeout for critical authorization calls to 7000ms.
