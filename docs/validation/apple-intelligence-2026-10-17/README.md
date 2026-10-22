# Local Apple Intelligence, App Intents and protocol audit — 2026-10-17

Chronoscope 0.15.0 adds focused Apple on-device analysis assistance with shared CLI/MCP operations and five native App Intents. Direct PCC is not used. Availability is checked through FoundationModels; the fm CLI and its setup are not required.

The coverage audit confirmed additive/subtractive/toggle selection, display options, appearance preferences and live renderer inspection already use shared commands. SI gear/menu layout is presentation. Added `analysis_context`, `analysis_prepare`, `analysis_execute` and `si_apple_status`, expanded provider discovery/configuration and regenerated TypeScript contracts. Also corrected embedded MCP root normalization for macOS /var aliases; the narrower assistant file root remains enforced.

Local model testing found incorrect arithmetic and inconsistent routing with a larger structured proposal. Production code now handles explicit command wording and unit conversions deterministically. The native model classifies other wording and explains bounded computed evidence. Prepared configurations require review, reject missing thresholds and expire with workspace revisions. Explanations use saved analysis evidence and disclose when the current workspace differs; they are not new calculations or verified causal explanations.

Validation includes 242 Rust tests, all-target Clippy, actual native model availability/classifier calls, the full local SI browser review/execute/explain/cancel workflow, the existing scripted hosted SI/external MCP fixture suite, real CLI and MCP transports, and 100,000-event exact eligibility/analysis. The 100k recommendation result was 1,444 bytes; all 100,000 events were evaluated by the reviewed gap analysis. Timings in the report are single debug-build observations, not performance guarantees or native FPS measurements.

All five real Swift AppIntent perform methods passed against a synthetic engine: summary, view switching, additive entity selection, recommendations and gap analysis. The Mac bundle carries actual compiler-extracted actions and App Shortcuts metadata, with local-device authentication. App Intents do not provide a Siri chat API inside SI, and fixed App Shortcut phrases do not imply support for arbitrary Siri semantic schemas.

Native SI settings, reviewed gap analysis (188 findings over 192 synthetic events) and an actual local explanation were checked in the Mac app. Windows/Linux runtime behavior and older macOS versions were not run on this Mac. No GitHub-hosted workflows were started.

See [report.json](report.json) for bounded evidence and final discovery status.

App Intents status: all five actions are visible in Shortcuts, but actual system execution fails in the unsigned/ad hoc build. Administrator-provided linkd diagnostics identify the cause: `Unable to get teamId from org.chronoscope.desktop`, followed by rejection under `requiresValidatedBundle` on `com.apple.linkd.mediator`. An independent minimal native Swift app reproduced the same missing-team-ID rejection. This is a system signing gate, not evidence of a successful end-to-end Siri/Shortcuts test. An Apple team signing identity is needed for this handoff on the test Mac; no identity, private entitlement or security exception was created. Local FoundationModels inference, CLI and MCP work unsigned.
