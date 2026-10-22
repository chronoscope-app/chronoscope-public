# Security reporting

Do not report exploitable vulnerabilities, credentials or private datasets in public issues. The canonical source repository is https://github.com/chronoscope-app/chronoscope-public .

The maintainer has selected GitHub private vulnerability reporting for publication. Once enabled and verified, use **Security → Report a vulnerability** at https://github.com/chronoscope-app/chronoscope-public/security/advisories/new . This preparation does not establish that the route is enabled. If the private-report form is unavailable, do not post sensitive details publicly; wait for a verified private reporting route. No dedicated security mailbox or response-time SLA is promised. A policy link alone is not a functioning private intake.

Include affected version/source SHA, platform, a minimal synthetic reproduction, impact and safe mitigation. Omit real tokens, client certificates, personal project files and location data. Coordinate disclosure privately before publishing exploit details.

Development source is not a hardened or supported production service. Only current main is a maintenance target. This clean snapshot includes no earlier Git history or binary releases; historical previews have no promised support window and are not covered by current-source security results. Third-party dependencies, local files, remote SI/MCP services and map providers have distinct trust boundaries.

Publication must enable and verify private reporting and then update these instructions to reflect the working route. Track that step in the [publication checklist](docs/PUBLICATION-CHECKLIST.md). For routine data-handling questions, read [privacy and connections](PRIVACY.md).
