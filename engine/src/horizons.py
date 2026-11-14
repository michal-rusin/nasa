"""Horizons query -> ephem.bin (owner: friend)."""
from pathlib import Path
import numpy as np
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DATA_RAW = ROOT_DIR / "data" / "raw"
DATA_OUT = ROOT_DIR / "data" / "out" / "v1"

DATA_RAW.mkdir(parents=True, exist_ok=True)
DATA_OUT.mkdir(parents=True, exist_ok=True)

AU_TO_KM = 149597870.7


def fetch_horizons_csv() -> str:
    """Pobiera efemerydy Księżyca (301) względem Ziemi (500@399) na cały rok 2028."""
    url = "https://ssd.jpl.nasa.gov/api/horizons.api"
    params = {
        "format": "text",
        "COMMAND": "'301'",
        "CENTER": "'500@399'",
        "MAKE_EPHEM": "'YES'",
        "TABLE_TYPE": "'OBSERVER'",  # liczba pojedyncza wymagana przez Horizons
        "START_TIME": "'2028-01-01 00:00'",
        "STOP_TIME": "'2028-12-31 23:00'",  # rok przestępny 2028 -> dokładnie 8784 godziny
        "STEP_SIZE": "'1h'",
        "QUANTITIES": "'14,15,20'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }

    print("Wysyłanie zapytania do NASA JPL Horizons API (rok 2028)...")
    response = requests.get(url, params=params, timeout=60)
    if not response.ok:
        print(f"\n--- BŁĄD HTTP {response.status_code} ---")
        print(response.text)
        response.raise_for_status()

    text = response.text
    if "$$SOE" not in text or "$$EOE" not in text:
        print("\n--- ODPOWIEDŹ SERWERA NASA (BRAK TABELI) ---")
        print(text[-2000:])
        raise RuntimeError("Brak znaczników $$SOE / $$EOE w odpowiedzi z Horizons.")

    raw_path = DATA_RAW / "horizons_2028.csv"
    raw_path.write_text(text, encoding="utf-8")
    print(f"[OK] Zapisano surowe dane: {raw_path}")
    return text


def extract_header_and_rows(text: str) -> tuple[list[str], list[str]]:
    """Wyciąga nazwy kolumn z nagłówka oraz wiersze danych między $$SOE a $$EOE."""
    before_soe, after_soe = text.split("$$SOE", maxsplit=1)
    data_block = after_soe.split("$$EOE", maxsplit=1)[0]

    header_line = None
    for line in reversed(before_soe.splitlines()):
        if "ObsSub-LON" in line and "delta" in line:
            header_line = line.strip()
            break

    if not header_line:
        raise ValueError("Nie znaleziono nagłówka kolumn przed znacznikiem $$SOE.")

    headers = [col.strip() for col in header_line.split(",")]
    rows = [line.strip() for line in data_block.splitlines() if line.strip()]

    print("\n--- Nagłówek kolumn i pierwsze 3 wiersze danych ---")
    print(f"Nagłówek: {header_line}")
    for sample in rows[:3]:
        print(f"  {sample}")

    return headers, rows


def parse_and_save_ephem(headers: list[str], rows: list[str]) -> None:
    """Dobiera kolumny po nazwach z nagłówka, przelicza współrzędne i zapisuje ephem.bin."""
    col_idx = {name.lower(): i for i, name in enumerate(headers) if name}

    required_cols = ["obssub-lon", "obssub-lat", "sunsub-lon", "sunsub-lat", "delta"]
    missing = [c for c in required_cols if c not in col_idx]
    if missing:
        raise KeyError(f"Brak wymaganych kolumn w nagłówku CSV: {missing}")

    n_steps = len(rows)
    print(f"\nLiczba wczytanych kroków czasowych: {n_steps} (oczekiwano 8784)")
    assert n_steps == 8784, f"Oczekiwano 8784 kroków, otrzymano {n_steps}!"

    ephem = np.zeros((n_steps, 6), dtype=np.float32)

    for i, row in enumerate(rows):
        parts = [p.strip() for p in row.split(",")]

        lon_e = float(parts[col_idx["obssub-lon"]])
        lat_e = float(parts[col_idx["obssub-lat"]])
        lon_s = float(parts[col_idx["sunsub-lon"]])
        lat_s = float(parts[col_idx["sunsub-lat"]])
        delta_au = float(parts[col_idx["delta"]])

        # Konwersja na radiany (East-longitude positive)
        lon_s_rad, lat_s_rad = np.radians(lon_s), np.radians(lat_s)
        lon_e_rad, lat_e_rad = np.radians(lon_e), np.radians(lat_e)

        # Wektor jednostkowy kierunku Słońca w MOON_ME
        sun_x = np.cos(lat_s_rad) * np.cos(lon_s_rad)
        sun_y = np.cos(lat_s_rad) * np.sin(lon_s_rad)
        sun_z = np.sin(lat_s_rad)

        # Położenie środka Ziemi [km] w MOON_ME
        dist_km = delta_au * AU_TO_KM
        earth_x = dist_km * np.cos(lat_e_rad) * np.cos(lon_e_rad)
        earth_y = dist_km * np.cos(lat_e_rad) * np.sin(lon_e_rad)
        earth_z = dist_km * np.sin(lat_e_rad)

        ephem[i] = [sun_x, sun_y, sun_z, earth_x, earth_y, earth_z]

    # --- Testy kontrolne (Sanity Checks) ---
    sun_norms = np.linalg.norm(ephem[:, :3], axis=1)
    earth_dists = np.linalg.norm(ephem[:, 3:], axis=1)
    sub_earth_lats = np.degrees(np.arcsin(ephem[:, 5] / earth_dists))

    print("\n--- Testy kontrolne (Sanity Checks) ---")
    print(f"Długość sun_dir: min={sun_norms.min():.6f}, max={sun_norms.max():.6f}")
    print(f"Odległość Ziemi: min={earth_dists.min():.1f} km, max={earth_dists.max():.1f} km")
    print(f"Szerokość sub-Ziemi: min={sub_earth_lats.min():.2f}°, max={sub_earth_lats.max():.2f}°")

    assert np.allclose(sun_norms, 1.0, atol=1e-5), "Wektory sun_dir nie są jednostkowe!"
    assert np.all((earth_dists >= 350000) & (earth_dists <= 415000)), "Odległość Ziemi poza zakresem!"
    assert np.all(np.abs(sub_earth_lats) <= 7.5), "Szerokość sub-Ziemi poza zakresem ±7°!"

    out_path = DATA_OUT / "ephem.bin"
    ephem.astype("<f4").tofile(out_path)
    print(f"\n[SUKCES] Zapisano {out_path} ({out_path.stat().st_size} bajtów, kształt: {ephem.shape})")


if __name__ == "__main__":
    raw_csv = fetch_horizons_csv()
    col_headers, data_rows = extract_header_and_rows(raw_csv)
    parse_and_save_ephem(col_headers, data_rows)