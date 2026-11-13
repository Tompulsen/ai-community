# 章鱼社区

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The frontend uses Vue 3, TypeScript, Vite and Vue Router, scaffolded from
the official Vite `vue-ts` template. Community and native creation now share one
Vue frontend, Fastify backend, application process and container. Existing Studio
account and generation rules are adapted into framework-independent server
modules; its Next.js source remains a reference outside the runtime image.
PostgreSQL, Redis, the document service and New API remain separate services.
The backend preserves the original tables, IDs, Redis namespaces and file storage.

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

- Public navigation groups home (首页), the promotion center, community and the
  creation desk in that order on desktop and mobile.
  Personal works and saved works live in the account menu.
- Home begins with segmented recommendations, latest and following modes, a
  horizontal type/tag rail. The top header contains expandable icon search and a
  submission entry that opens the existing work editor for members or login for guests.
  Types and content tags filter independently;
  the all option clears both. The rail supports touch, keyboard and scroll arrows.
  Its page heading remains available to screen readers; the visible heading and
  work count are omitted. Clearing conditions preserves content type and browse
  mode; restoring defaults resets the complete selection. Following requires login.
- Community announcements and creator profiles remain reachable.
- Publishing, saved work, notifications and administration have distinct places.
- Work editing and report resolution protect unsaved input when closing, navigating
  or refreshing. Successful saves release the guard; account changes clear the
  previous account's editor and ignore its delayed responses. This is leave
  protection, not automatic draft storage across reloads.
- Activity and announcement notifications have independent 30-item cursor pages
  and unread totals. Activity totals cover the retained Redis stream (approximately
  1,000 entries), not unlimited history. Category mark-all uses a captured stream
  boundary or a five-minute, account-bound announcement snapshot; new arrivals
  stay unread. Refresh starts at the newest page and rechecks visibility.
- The admin overview aggregates the complete submission dataset and open reports,
  with 7/30-day new-work counts and administrator-only local-user counts. Pending
  revisions can overlap published totals. The pending queue queries pending work
  directly. Administrator-only operation logs support actor, type, date and cursor
  filters, exposing safe summaries without raw configuration or credentials.
- A header community-tools launcher groups existing destinations in an icon grid,
  including work search, discovery, announcements, creators, saved work, messages,
  creation, promotions and account tools. Unread badges reuse the shared inbox;
  private destinations resume after sign-in and management remains role-gated.
  Reload and navigation retain existing unsaved-edit protection.
- The user selected the Aceternity Bento Grid reference for this redesign.
  Work galleries use five base columns on desktop; small cards span one, large
  cards span two. Small cards use a 4:5 ratio; large cards keep the same height.
  Known landscape covers prefer two columns when space remains in the row, without
  changing feed order. Covers fill and crop; clicking opens the detail page directly,
  where the complete media remains available.
  Smaller desktop widths use four columns, tablet two, phone one.
  Work cards retain one iOS style continuous outer corner without an inner frame.
- Existing feature scope is preserved. No new business capability is proposed.
- Run independent community foundation services. Reuse the existing business
  modules and adapt their integration points.
- Reuse provenance, dependencies and source declarations are tracked in REUSE.md.
- The runtime uses actual account and work data; synthetic state is removed.
- Native creation reuses the authenticated Octopus account; lottery uses real transaction and
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
- Community sign-in uses the Octopus account exclusively. Reuse the original
  account login and encrypted session in the Fastify process, and map issuer plus subject to
  existing community profiles. Keep old unlinked profiles without matching by
  username or email. Registration and password management belong to the account
  centre. Opening creation after community login uses that same account, balance
  and refresh lock immediately, without a second login, authorization or key setup.
  Account-owned browser history remains local; recovery only queries the original
  task and token, and never repeats an uncertain paid submission.
- Account settings show the existing numeric Octopus account ID as the Octopus
  number and use its verified username. Internal community profile IDs remain
  unchanged to preserve ownership; no additional public account number is issued.
- Detailed migration gates are recorded in MIGRATION.md. Licensing of newly
  authored source and final deployment details remain open decisions.

## Brand Commitments

The user has confirmed the community brand as “章鱼社区”. Use the user-provided
blue-background octopus image at `/assets/brand/octopus-community.jpg` as the brand logo.
The user approved implementing the recommended combination:
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
