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

- Public navigation groups home (首页), community and the creation desk in that
  order. Community pages use a 64px icon rail on desktop
  and bottom navigation on smaller screens. Logo, navigation, existing tools,
  and submission occupy the rail; settings stay at its bottom.
  Personal works and saved works remain reachable through existing tools.
- Home begins with discovery, latest, popular and following modes, plus a
  horizontal type/tag rail. Desktop community pages have a persistent full-width top search,
  with messages, welfare, account balance and the account menu at the right.
  Welfare is adjacent to points; announcements remain inside the message center.
  Below 1000px a compact
  header contains the menu, 发现 / 最新 / 热门 / 关注 links and expandable search.
  The same four browse modes are available on desktop. Types (including the resource
  category for text, code and Skills) and content tags remain in the mobile filter
  overlay without shifting the feed. Discovery learns matching tag preferences in
  a bounded browser profile; latest favors new works, popular uses existing interaction
  heat, and following retains its author relationship filter. Refresh replaces some
  first-page works whenever eligible alternatives exist, with stable pagination
  within each batch and preserved list/scroll when returning from work details.
  Only tag aggregates and limited recent IDs are retained locally, with expiry and
  a clear action; no server-side recommendation history is created. Mobile bottom navigation is
  首页 / 创作 / ＋ / 消息 / 我, with a 58px bar plus the device safe area.
  The mobile menu contains identity, full point balance, submission, logout and
  existing tools; unread counts and the in-place message center remain available.
  Discovery searches as users type; other pages submit to
  discovery. Submission opens the existing work editor for members or login for guests.
  Types and content tags filter independently;
  the all option clears both. The rail supports touch, keyboard and scroll arrows.
  Its page heading remains available to screen readers; the visible heading and
  work count are omitted. Clearing conditions preserves content type and browse
  mode; restoring defaults resets the complete selection. Following requires login.
- The whole mobile surface follows the user's local community-studio-ui reference:
  natural-ratio two-column feed, large profile hero with
  four shortcuts and three-column work grid, keyboard/swipe profile tabs, immersive
  work preview with separate comments and related-work drawers, compact messages,
  publishing, login and settings. The existing APIs, permissions, account and wallet
  integrations, native creation and draft protection remain authoritative.
- Community announcements and creator profiles remain reachable.
- Follow authors from work details, creator cards, profiles and follower lists.
  Relationships include following, mutual following and pending approval. Owners
  can approve/reject received requests, cancel sent requests and remove followers.
  Privacy settings control approval, newcomer age and list visibility; age uses
  the community joining timestamp. Existing pending requests remain manual after
  a rule change. Mutations bind the expected account and reuse existing tables.
- Desktop account settings hide the shared search, balance and avatar header without
  reserving its height. The global icon rail, settings navigation and logout remain;
  mobile keeps its compact header.
- Topup prioritizes amount selection, payment methods, the real quote, expected
  credit and confirmation in the first viewport. Mobile balance settings collapse
  the large sidebar and provide a return-to-settings control. The existing payment
  summary stays above mobile navigation, retaining quote errors and retry; payment,
  price-change confirmation and account isolation logic remain unchanged.
- Account settings include six built-in palettes, separately selected for light
  and dark mode, plus system and local-time scheduled switching. Porcelain/Obsidian
  (瓷白/曜石) are the defaults, with botanical green (薄雾/松影) and berry
  (初雪/绯夜) alternatives. Desktop and mobile use the same selected palette.
  Existing palette IDs and saved preferences remain valid. Preferences apply before app rendering
  and persist per browser, with same-browser tab synchronization and an explicit
  error when storage is unavailable. They do not synchronize across devices.
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
- A community-tools launcher groups existing destinations in an icon grid,
  including work search, discovery, announcements, creators, saved work, messages,
  creation, welfare and account tools. Unread badges reuse the shared inbox;
  private destinations resume after sign-in and management remains role-gated.
  Reload and navigation retain existing unsaved-edit protection.
  Desktop menus open to the right of the rail; changing the desktop breakpoint closes
  open menus. Short rail navigation scrolls independently without covering settings.
  Studio and standalone guest login retain their own layout.
- The current user reference is a compact Pinterest-style masonry gallery.
  Discovery uses the available page width with approximately 200px-wide columns,
  a 16px horizontal gap and at least 24px between cards in a column; phones use two
  columns. Covers retain their natural aspect ratio without cropping, with 8px
  media corners. Titles, authors and likes sit below each cover without a shade.
  Feed and keyboard order stay unchanged; media loading, resizing and pagination
  repack the grid. Clicking still opens details directly. Hover changes opacity
  without moving cards. Loading skeletons use the same columns and information layout.
- Existing feature scope is preserved. No new business capability is proposed.
- Run independent community foundation services. Reuse the existing business
  modules and adapt their integration points.
- Reuse provenance, dependencies and source declarations are tracked in REUSE.md.
- The runtime uses actual account and work data; synthetic state is removed.
- Native creation reuses the authenticated Octopus account; lottery uses real transaction and
  receipt logic. Do not replay paid requests as harmless tests.
- The welfare center (福利中心) supports a daily pool resetting at 00:00 Asia/Shanghai.
  Each user may spend one earned lottery ticket per day. Defaults are 200 places:
  6,000 points × 40, 4,000 × 50, 2,000 × 50, and “🤡 非常遗憾” at 1,000 × 60.
  Admins independently edit prize names, points, daily quantities and the total daily limit.
  Active quantities must sum to that limit; probability follows remaining quantities.
  Pending delivery still consumes the place, and configuration edits never refund today's usage.
  Existing ticket balances, historical receipts and legacy lottery settings remain compatible.
- Image and video creation display the submitted prompt, references and parameters
  beside a model response with real status and elapsed time. Inputs stay editable
  during generation, and the send control can stop local waiting. Existing gallery
  preview, downloads, publication and history are reused. Recovery reads the original
  request and continues polling its task, without submitting another paid generation.
- Mobile creation uses one compact workspace toolbar and a two-row composer below
  real account balance/pricing metadata. Community navigation remains reachable
  through the workspace menu. The composer follows visual viewport resizing, and
  unknown pricing or balance is never represented as a zero charge or balance.
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
  username or email. Registration stays on the community page and calls the account
  centre's public API; the centre creates the authoritative account. Success returns
  to the in-page login with the username retained, password cleared, a fresh
  challenge and the original returnTo preserved. Password management remains at
  the account centre. Opening creation after community login uses that same account, balance
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

制作同款默认仅填入公开提示词，模型仍由当前账号选择，不自动触发生成或带入原作成品。
作者公开的参考图通过“参考图”选择，用户也能自行上传、移除；图片/视频草稿刷新后保留选择。
已完成结果可从创作台或作品库发布到社区；带来源的图片、文本另可发送到源作品评论区，
视频沿用旧社区规则仅发布社区。提交前可编辑标题和说明，按现有审核设置显示结果与查看入口。
发布过程中不会重发生成请求，网络中断后重试沿用已上传文件和原提交内容。
