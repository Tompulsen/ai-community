# Third-party notices

The preview frontend was written using the official Vite Vue/TypeScript
scaffold. The replacement application also reuses later-added business modules
from the existing community, as explicitly requested by the owner.

Reused business sources and their tests are documented in `REUSE.md`.
`server/business/lottery.ts` and `server/business/ads.ts` retain the original
SPDX copyright and AGPL-3.0-only declarations. These modules are not described
as newly authored or MIT-licensed. Existing declarations are retained; being a
later addition does not by itself change a source file's license.

Runtime packages and their upstream declared licenses:

- Vue: MIT.
- Vue Router: MIT.
- Lucide Vue: ISC. Lucide contains community contributions with its package's
  attribution terms; retain the installed package LICENSE.
- pg: MIT.
- yaml: ISC.
- bcryptjs: BSD-3-Clause.
- otpauth and ioredis: MIT.
- Fastify and @fastify/multipart: MIT.
- Sharp: Apache-2.0; its packaged libvips dependencies retain their own notices.
- Nodemailer: MIT-0.
- FFmpeg is installed from the Alpine package repository. Its installed build
  and linked codecs retain the distribution's license and copyright files.

The adapted authentication, content, account and lottery services retain AGPL
notices. The repository LICENSE is retained from the reused community source.
`studio/` retains its MIT/NextChat notices. `services/documents/` retains its
AGPL service declarations and QXChat MIT / GenOffice Apache-2.0 provenance.

Development tools retain their own package licenses, including Vite, TypeScript,
Vitest, Playwright and axe-core. Consult `package-lock.json` and installed package
LICENSE files for the exact installed versions and full texts. This file is not
a replacement for those texts.

The local `awesome-design-md` collection is an MIT-licensed design reference
by VoltAgent (2026). Its documentation informed layout decisions; the reference
sites' brand marks, custom fonts and product implementation were not imported.

Unused preview photography and the MDN CC0 video were removed from the runtime
assets. Their historical source record is retained in `ASSETS.md`.
