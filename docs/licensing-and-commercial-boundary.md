# Licensing and commercial boundary

This document records the intended separation between the Mind Atlas community
edition and future proprietary products. It is an engineering and repository
policy, not a replacement for the applicable license text.

## Community edition

Unless a file contains an explicit different notice, tracked source code and
documentation in this repository are licensed under `AGPL-3.0-only`.

The community edition should remain independently useful for local-first
personal work. It includes the spatial notebook, generated layouts, outline
editing, import/export, local persistence, community bridge integrations, and
other functionality already present in this repository.

Community contributions require acceptance of [../CLA.md](../CLA.md). The CLA
preserves the contributor's copyright while granting the Project Owner the
rights needed for dual licensing and future project transfer.

## Alternative commercial license

The Project Owner may offer the same code under a separate commercial
agreement. This is useful for proprietary embedding, closed-source hosted
modifications, OEM distribution, license incompatibility, or contractual
support. See [../COMMERCIAL-LICENSE.md](../COMMERCIAL-LICENSE.md).

## Future proprietary products

Future proprietary functionality must not be added to this AGPL repository
without an explicit licensing decision. It should live in a separately
licensed repository, package, service, or clearly isolated directory with its
own license notice.

## Current hosted service code

The current ConoHa/VPS hosted-service implementation in this repository is
part of the AGPL community source unless a file says otherwise. That includes
the Node service entry point, database migration code, provider proxy logic,
credit ledger implementation, staging Docker files, and deployment templates.

Publishing that source does not publish or license the official production
operation itself. The following must remain outside the public repository:

- `.env.service`, `.env.local`, and all real environment files;
- Google OAuth client secrets, Stripe secret keys, webhook secrets, provider
  API keys, VPS SSH keys, and database passwords;
- PostgreSQL data, backups, dumps, and migration snapshots containing live
  customer data;
- server access logs, AI request logs, billing records, support records,
  analytics exports, and incident notes containing personal data;
- official domain, account, billing, and infrastructure credentials.

Forks may run the AGPL service code under the GNU AGPL, but they do not receive
rights to use the Mind Atlas marks as an official service, and modified hosted
versions must comply with AGPL network-source obligations.

Likely proprietary areas include:

- official encrypted Sync infrastructure and managed backup services;
- license activation, billing, and entitlement services;
- Team administration, organization policy, SSO, and directory integration;
- shared approval workflows, audit retention, and organization cost
  allocation;
- managed cloud operations, enterprise deployment tooling, support, and SLA
  systems;
- official commercial desktop packaging and update services when they contain
  proprietary components.

The open-source edition must not import proprietary source directly. Integration
should use stable APIs, protocols, build-time package boundaries, or service
interfaces so that license scope remains understandable.

## Brand boundary

Copyright permissions do not include permission to present a fork as an
official Mind Atlas product. The name, logo, domain, and source-identifying
branding are governed by [../TRADEMARKS.md](../TRADEMARKS.md).

## Acquisition and governance hygiene

To preserve a clean chain of title:

- require the CLA check for every external pull request;
- keep the list of copyright holders and third-party dependencies accurate;
- record exceptions and separately licensed files in this document;
- avoid copying code with unclear provenance;
- keep proprietary code out of this repository unless its boundary is
  explicitly documented; and
- preserve repository, CLA, release, domain, trademark, and commercial
  agreement records for due diligence.
