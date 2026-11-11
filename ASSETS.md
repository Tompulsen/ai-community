# Preview Image Sources

Historical record: these unreferenced demo images and video were removed during
the full-stack development replacement. Runtime work media now comes from the
original community file storage. Individual retired files remain in the local,
ignored `.impeccable/backups/backend-port/retired-preview/` folder.

These ten photographs are local demo fixtures for the AI community preview.
They are not community uploads, not AI-generated artwork, and not works created
by the fictional authors shown in the interface. No photographer endorsement is
implied.

Source: the public Unsplash image CDN. The URLs below identify the original
source images and the exact JPEG delivery parameters used for this preview.
See the [Unsplash License](https://unsplash.com/license) before production reuse.
This preparation verified image delivery and decoding, not individual releases
or other subject-specific rights.

All ten photographs were downloaded on 2026-11-12. Each request returned HTTP 200 with
`Content-Type: image/jpeg`. Each file was decoded locally, checked for a
nonblank image, and visually inspected in a contact sheet. Images retain their
source aspect ratios; the site can crop them in its layout.

| Local File | Subject | Pixels | Original Source |
| --- | --- | --- | --- |
| `public/media/architecture.jpg` | Modern white architecture | 1200 x 800 | https://images.unsplash.com/photo-1487958449943-2429e8be8625?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/forest.jpg` | Sunlight in a green forest | 1200 x 800 | https://images.unsplash.com/photo-1448375240586-882707db888b?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/mountains.jpg` | Alpine mountain landscape | 1200 x 800 | https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/city.jpg` | City street at dusk | 1200 x 1501 | https://images.unsplash.com/photo-1519501025264-65ba15a82390?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/portrait.jpg` | Portrait with colored studio light | 1200 x 1500 | https://images.unsplash.com/photo-1534528741775-53994a69daeb?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/coast.jpg` | Sea wave near the coast | 1200 x 1797 | https://images.unsplash.com/photo-1500375592092-40eb2168fd21?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/abstract.jpg` | Colorful abstract photography | 1200 x 800 | https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/desert.jpg` | Red desert rock formations | 1200 x 795 | https://images.unsplash.com/photo-1509316785289-025f5b846b35?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/interior.jpg` | Sunlit living room | 1200 x 900 | https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?fm=jpg&fit=max&w=1200&q=85 |
| `public/media/lake.jpg` | Mountain lake and lakeside cabin | 1200 x 800 | https://images.unsplash.com/photo-1470770841072-f978cf4d019e?fm=jpg&fit=max&w=1200&q=85 |

## Video Preview Fixture

`public/media/flower.mp4` is MDN's public CC0 flower video sample, downloaded
on 2026-11-12 from:

https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4

The request returned HTTP 200 with `Content-Type: video/mp4`. The downloaded
file is 1,128,375 bytes, H.264, 960 x 540 pixels, approximately 29.97 fps, and
5.055 seconds long. A complete local FFmpeg decode passed.

`public/media/flower.jpg` is the 51,114-byte poster frame extracted at 1.000
seconds from that video, retaining the native 960 x 540 pixel dimensions.
The frame was decoded and visually inspected. Both files are demo fixtures,
not community submissions or AI-generated works.

## Embedded Source Notes

All eleven JPEG files carry a JPEG COM note beginning with
`SOURCE (not generated):`, followed by the source URL documented above and
`stock photo used only for local preview; see ASSETS.md.` The flower poster
references the MDN video from which it was extracted.

The Impeccable tool calls this storage field a prompt. Its contents here are
source provenance only, not a generation prompt or a claim that the image was
generated. Individual original files are backed up in `.impeccable/backups/`.
Decoded pixel SHA-256 hashes match those backups for all eleven images.
The MP4 file was not modified.
