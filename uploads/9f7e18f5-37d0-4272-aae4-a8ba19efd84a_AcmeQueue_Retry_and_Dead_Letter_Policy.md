# AcmeQueue Retry and Dead-Letter Policy

**Document ID:** MQ-ADR-014\
**Team:** Platform Runtime\
**Status:** Approved\
**Last updated:** 2026-08-12

## Purpose

This document describes how services should handle temporary failures
when publishing or processing messages through AcmeQueue.

## Retry policy

AcmeQueue uses exponential backoff for retryable message-processing
failures.

  Attempt     Delay before retry
  --------- --------------------
  1                    2 seconds
  2                    4 seconds
  3                    8 seconds
  4                   16 seconds

A message is attempted a maximum of **4 times after the initial
attempt**.

## Retryable errors

-   Temporary network interruptions.
-   A downstream service returning HTTP 502 or HTTP 503.
-   A downstream service timing out.

## Non-retryable errors

-   Invalid message schema.
-   Missing required message fields.
-   Authentication or authorization failures caused by invalid
    credentials.

Non-retryable messages are sent directly to the dead-letter queue (DLQ).

## Dead-letter queue

When a message exhausts all retry attempts, AcmeQueue moves it to
`acmequeue-dead-letter`.

Each DLQ entry retains: - Original message ID. - Original payload. -
Failure reason. - Number of processing attempts. - Timestamp of the
final failure.

The Platform Runtime team reviews DLQ volume every weekday. A sudden
increase in DLQ messages should trigger an investigation before messages
are replayed.

## Replay procedure

Only an authorized platform operator may replay DLQ messages.

Before replaying: 1. Identify and fix the underlying failure. 2. Inspect
a sample of affected messages. 3. Confirm that replaying will not create
duplicate business operations. 4. Replay messages in batches of no more
than **100**.

Messages with invalid schemas must be corrected before replay. They must
not be replayed unchanged.

## Monitoring

The following metrics are exposed: - `acmequeue_retry_total`: total
retry attempts. - `acmequeue_dlq_depth`: current number of messages in
the dead-letter queue. - `acmequeue_processing_latency_ms`: message
processing latency in milliseconds.

An alert is raised when DLQ depth exceeds **500 messages for more than
10 minutes**.

## Ownership

The Platform Runtime team owns the AcmeQueue retry policy, DLQ
operations, and replay permissions.
