# Architecture Decision Record (ADR) 005
Date: 2024-11-02
Topic: Caching Strategy for Frontend API Gateway

## Context
The Frontend API Gateway is experiencing high latency under load because it fetches data from downstream microservices for every request. Some of this data, like feature flags and static taxonomy, rarely changes.

## Decision
We will introduce Redis as a caching layer in the API Gateway. 
We will use a cache-aside pattern: the Gateway will first check Redis, and on a cache miss, it will fetch from the downstream service and write back to Redis.

## TTL Policies
- Feature Flags: TTL 60 seconds
- Taxonomy data: TTL 1 hour
- User Sessions: Managed by AcmeAuth (Do not cache manually)
