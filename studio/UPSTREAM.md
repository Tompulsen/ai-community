# Community studio

Vendored from qzq00767/octopus_chat at d50f6562a143b192386ac37fde0850d578bde989.
MIT license and upstream notices retained. Runtime is maintained and deployed from Tompulsen/ai-community.

Web retrieval adapts the MIT-licensed QXChat (NextChat) implementation from
`D:/ip/QXChat(积分)` (`app/api/web-search/search.ts`, `page-reader.ts`, and
`app/utils/web-search.ts`), reviewed November 11, 2026. The corresponding files
are `app/lib/web-search/*` and `app/utils/web-search-context.ts`. Copyright
(c) 2023-2025 NextChat; the full MIT notice remains in `LICENSE`.
Community authentication and rate limits are retained. Quick mode supplies
ranked DuckDuckGo/Bing snippets; deep mode additionally reads two public pages.
Explicit webpage URLs are read directly. No Tavily channel is required.
