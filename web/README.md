Data: `npm run sync-data` copies `../data/out/${DATA_VERSION:-v1}/` to `public/data/` (removing old `.json`/`.bin` files, `masks/`, and `layers/`; `public/data/sample/` is preserved).
`npm run dev` synchronizes data automatically; if the source is missing, it only warns and starts with the existing contents of `public/data/`.
`npm run build` requires the source (missing source = error, exit 1); select another version with `DATA_VERSION` (e.g. `DATA_VERSION=v2 npm run build`).
