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
- ioredis: MIT.
- iron-session 8.0.4: MIT, Copyright (c) 2021 Vincent Voyer. Its installed
  `LICENSE.md` is retained with the runtime dependency. The existing Studio
  encrypted session format is reused without adding a Next.js runtime.
- Fastify and @fastify/multipart: MIT.
- Sharp: Apache-2.0; its packaged libvips dependencies retain their own notices.
- Nodemailer: MIT-0.
- FFmpeg is installed from the Alpine package repository. Its installed build
  and linked codecs retain the distribution's license and copyright files.

The adapted authentication, content, account and lottery services retain AGPL
notices. The repository LICENSE is retained from the reused community source.
`studio/` retains its MIT/NextChat notices as reference source, and is excluded
from the community image. Its account bridge was ported to
`server/native-account/`; request parsing, pricing, public-media fetching,
proxy lifecycle and generation/task protocol rules were also adapted from
Studio utilities and routes. Exact source paths are listed in `REUSE.md`.
These ports retain the Studio MIT/NextChat provenance; moving them into the
community service does not remove the original notice below.
`services/documents/` remains an independent service and retains its AGPL
service declarations and QXChat MIT / GenOffice Apache-2.0 provenance.

MIT notice for the reused Studio sources, retained here so it is distributed
with the community image even though `studio/` is not:

```text
MIT License

Copyright (c) 2023-2025 NextChat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Development tools retain their own package licenses, including Vite, TypeScript,
Vitest, Playwright and axe-core. Consult `package-lock.json` and installed package
LICENSE files for the exact installed versions and full texts. This file is not
a replacement for those texts.

The local `awesome-design-md` collection is an MIT-licensed design reference
by VoltAgent (2026). Its documentation informed layout decisions; the reference
sites' brand marks, custom fonts and product implementation were not imported.

Unused preview photography and the MDN CC0 video were removed from the runtime
assets. Their historical source record is retained in `ASSETS.md`.

The guest login layout, geometric characters and pointer/password interactions
are adapted from arsh342/careercompass (Copyright (c) 2025 arsh342, MIT).
The Vue implementation is in `src/components/LoginCharacters.vue` and the
guest section of `src/views/AccountView.vue`. The full upstream MIT notice ships
in `public/assets/licenses/careercompass-MIT.txt`. No CareerCompass branding,
Firebase authentication or Google sign-in service is imported.
