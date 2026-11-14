Dane: `npm run sync-data` kopiuje `../data/out/${DATA_VERSION:-v1}/` do `public/data/` (czyści stare `.json`/`.bin`, `masks/`, `layers/`; `public/data/sample/` zostaje).
`npm run dev` synchronizuje dane automatycznie; gdy źródła brak, tylko ostrzega i startuje na tym, co jest w `public/data/`.
`npm run build` wymaga źródła (brak = błąd, exit 1); inną wersję wybierzesz zmienną `DATA_VERSION` (np. `DATA_VERSION=v2 npm run build`).
