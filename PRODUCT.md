# AI 创作社区

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The frontend uses Vue 3, TypeScript, Vite and Vue Router, scaffolded from
the official Vite `vue-ts` template. The unified application direction is one
repository with a shared account and API boundary, one community entry and a
coordinated release. Existing Next.js/React Studio code can remain an internal
module; one project does not require one frontend framework, process or container.
Choose the backend runtime and hosting arrangement from actual reuse dependencies
rather than rewriting mature modules for framework uniformity. The independent
Node.js backend now reuses the original PostgreSQL tables, Redis prefix and file
storage. Studio and document source are included and their running services reused.

## Users

People browsing, creating and sharing AI images, videos, text, code and Skills.
Creators also manage their own work; operators review submissions and activity
records.

## Product Purpose

Develop an independent community application with a clearer layout than the
existing community. The user requires one complete replacement project covering
frontend, backend and business data migrated from the incumbent. The current
delivery now includes the frontend and an independent community backend.

## Capabilities and Constraints

- Four main tasks: discover, create, personal works, activities.
- Community announcements and creator profiles remain reachable.
- Publishing, saved work, notifications and administration have distinct places.
- The user selected the Aceternity Bento Grid reference for this redesign.
  Work galleries use five base columns on desktop; small cards span one, large
  cards span two. Small cards use a 4:5 ratio; large cards keep the same height.
  Known landscape covers prefer two columns when space remains in the row, without
  changing feed order. Covers fill and crop; clicking opens the detail page directly,
  where the complete media remains available.
  Smaller desktop widths use four columns, tablet two, phone one.
  The user also requested concentric, iOS style continuous corners on nested card surfaces.
- Existing feature scope is preserved. No new business capability is proposed.
- Run independent community foundation services. Reuse the existing business
  modules and adapt their integration points.
- Reuse provenance, dependencies and source declarations are tracked in REUSE.md.
- The runtime uses actual account and work data; synthetic state is removed.
- Creation reuses the authenticated Studio; lottery uses real transaction and
  receipt logic. Do not replay paid requests as harmless tests.
- The user confirmed a development environment with no active users and requested
  a fast container replacement. Keep data volumes and a recoverable snapshot.
- This is a development release with focused checks, not full production acceptance.
- Upload limits inherit site and role policy. A background worker processes new
  image thumbnails and video covers. Time-based privacy uses the original ID
  codec and visibility rules.
- Migration must preserve identity, permissions, work/file relationships,
  interactions and reward receipts; include Redis and browser-local data.
- External account balance stays authoritative in the account service.
- Detailed migration gates are recorded in MIGRATION.md. Licensing of newly
  authored source and final deployment details remain open decisions.

## Brand Commitments

Use the existing code's conservative fallback name, “AI 创作社区”, until the user
confirms a new name. The user approved implementing the recommended combination:
Linear for hierarchy, Pinterest for image emphasis, Runway for work details.
These references inform one consistent visual system.

The user-facing name of the connected account is “章鱼账号”. Keep implementation
and integration documentation precise about New API, while using this product
name in account, activity, reward and balance UI.

## Evidence on Hand

The user-provided local `awesome-design-md` collection contains the reference
documents. Existing product capability names were checked with targeted,
read-only inspection of the incumbent application. The first reused business
modules are the later-added lottery rules/receipt checks and advertisement
normalization; they retain their source notices.

## Product Principles

1. Keep the work prominent and operations predictable.
2. Give every function one clear home.
3. Distinguish creation, drafts, submission and public visibility.
4. Keep activity chances, awarded amounts and account balance separate.
5. Never present a local preview result as a live account or financial operation.

## Accessibility & Inclusion

Chinese is the initial interface language. Support keyboard navigation, visible
focus, labelled form controls, reduced motion and readable contrast. Mobile is a
responsive web view, not a separate native app.
