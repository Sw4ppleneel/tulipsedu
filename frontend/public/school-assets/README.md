# Per-school website assets

Each school's public-website images live in its **own folder, named by tenant slug**:

```
school-assets/
  <tenant-slug>/
    logo.svg        # school logo (preferred). logo.png also accepted
    hero.jpg        # homepage hero background
    building.jpg    # "About" section building photo
    principal.jpg   # principal's photo
    gallery1.png    # gallery images, numbered 1..9
    gallery2.png
    ...
```

Current tenant slugs:

| Slug | School |
|---|---|
| `daffodilspublicschool` | Daffodils Public School |
| `vivekmemorialhighschool` | Vivek Memorial High School |
| `premchandmahtoic` | Premchand Mahto IC |
| `premchandhighschool` | Premchand High School |

## How the path is resolved

The frontend builds each URL as `<BASE>/<slug>/<file>` via `schoolAsset(slug, file)`
in `src/assets.ts`. Any file that is missing simply falls back to a labelled
placeholder — so you can drop images in incrementally.

- **Local / default**: `BASE = /school-assets` → files served from this folder.
- **Production (R2/CDN)**: set the build-time env var
  `VITE_SCHOOL_ASSET_BASE=https://cdn.tulipsedu.in/school-assets`
  and upload each school's folder to the R2 bucket under the same
  `school-assets/<slug>/...` layout. No code changes needed.

> Note: the Tulips.edu brand logo (tulip + graduation cap) is **not** a school
> asset — it lives at `/tulips-logo.jpg` and powers the PWA icons. School logos
> are per-slug `logo.svg` files placed here.
