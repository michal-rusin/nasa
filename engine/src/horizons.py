"""Horizons query -> ephem.bin (owner: friend).

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
import calendar
from pathlib import Path
import numpy as np
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DATA_RAW = ROOT_DIR / "data" / "raw"
DATA_OUT = ROOT_DIR / "data" / "out" / "v1"

DATA_RAW.mkdir(parents=True, exist_ok=True)
DATA_OUT.mkdir(parents=True, exist_ok=True)

AU_TO_KM = 149597870.7
YEARS = range(2028, 2038)  # 2028..2037, one query per year


def fetch_horizons_csv(year: int) -> str:
    """Fetch lunar ephemerides (301) relative to Earth (500@399) for the given full year."""
    url = "https://ssd.jpl.nasa.gov/api/horizons.api"
    params = {
        "format": "text",
        "COMMAND": "'301'",
        "CENTER": "'500@399'",
        "MAKE_EPHEM": "'YES'",
        "TABLE_TYPE": "'OBSERVER'",  # singular form required by Horizons
        "START_TIME": f"'{year}-01-01 00:00'",
        "STOP_TIME": f"'{year}-12-31 23:00'",  # 8760 hours, 8784 in a leap year
        "STEP_SIZE": "'1h'",
        "QUANTITIES": "'14,15,20'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }

    print(f"Querying NASA JPL Horizons API (year {year})...")
    response = requests.get(url, params=params, timeout=60)
    if not response.ok:
        print(f"\n--- HTTP ERROR {response.status_code} ---")
        print(response.text)
        response.raise_for_status()

    text = response.text
    if "$$SOE" not in text or "$$EOE" not in text:
        print("\n--- NASA SERVER RESPONSE (MISSING TABLE) ---")
        print(text[-2000:])
        raise RuntimeError("Missing $$SOE / $$EOE markers in the Horizons response.")

    raw_path = DATA_RAW / f"horizons_{year}.csv"
    raw_path.write_text(text, encoding="utf-8")
    print(f"[OK] Saved raw data: {raw_path}")
    return text


def extract_header_and_rows(text: str) -> tuple[list[str], list[str]]:
    """Extract column names from the header and data rows between $$SOE and $$EOE."""
    before_soe, after_soe = text.split("$$SOE", maxsplit=1)
    data_block = after_soe.split("$$EOE", maxsplit=1)[0]

    header_line = None
    for line in reversed(before_soe.splitlines()):
        if "ObsSub-LON" in line and "delta" in line:
            header_line = line.strip()
            break

    if not header_line:
        raise ValueError("Column header not found before the $$SOE marker.")

    headers = [col.strip() for col in header_line.split(",")]
    rows = [line.strip() for line in data_block.splitlines() if line.strip()]

    print("\n--- Column header and first 3 data rows ---")
    print(f"Header: {header_line}")
    for sample in rows[:3]:
        print(f"  {sample}")

    return headers, rows


def parse_ephem(headers: list[str], rows: list[str]) -> np.ndarray:
    """Select columns by header name and convert coordinates to ephem.bin rows."""
    col_idx = {name.lower(): i for i, name in enumerate(headers) if name}

    required_cols = ["obssub-lon", "obssub-lat", "sunsub-lon", "sunsub-lat", "delta"]
    missing = [c for c in required_cols if c not in col_idx]
    if missing:
        raise KeyError(f"Missing required columns in CSV header: {missing}")

    n_steps = len(rows)
    ephem = np.zeros((n_steps, 6), dtype=np.float32)

    for i, row in enumerate(rows):
        parts = [p.strip() for p in row.split(",")]

        lon_e = float(parts[col_idx["obssub-lon"]])
        lat_e = float(parts[col_idx["obssub-lat"]])
        lon_s = float(parts[col_idx["sunsub-lon"]])
        lat_s = float(parts[col_idx["sunsub-lat"]])
        delta_au = float(parts[col_idx["delta"]])

        # Convert to radians (East-longitude positive)
        lon_s_rad, lat_s_rad = np.radians(lon_s), np.radians(lat_s)
        lon_e_rad, lat_e_rad = np.radians(lon_e), np.radians(lat_e)

        # Unit direction vector to the Sun in MOON_ME
        sun_x = np.cos(lat_s_rad) * np.cos(lon_s_rad)
        sun_y = np.cos(lat_s_rad) * np.sin(lon_s_rad)
        sun_z = np.sin(lat_s_rad)

        # Position of Earth's center [km] in MOON_ME
        dist_km = delta_au * AU_TO_KM
        earth_x = dist_km * np.cos(lat_e_rad) * np.cos(lon_e_rad)
        earth_y = dist_km * np.cos(lat_e_rad) * np.sin(lon_e_rad)
        earth_z = dist_km * np.sin(lat_e_rad)

        ephem[i] = [sun_x, sun_y, sun_z, earth_x, earth_y, earth_z]

    return ephem


def save_ephem(ephem: np.ndarray) -> None:
    """Check the entire series and save ephem.bin."""
    # --- Sanity checks ---
    sun_norms = np.linalg.norm(ephem[:, :3], axis=1)
    earth_dists = np.linalg.norm(ephem[:, 3:], axis=1)
    sub_earth_lats = np.degrees(np.arcsin(ephem[:, 5] / earth_dists))

    print("\n--- Sanity checks ---")
    print(f"sun_dir length: min={sun_norms.min():.6f}, max={sun_norms.max():.6f}")
    print(f"Earth distance: min={earth_dists.min():.1f} km, max={earth_dists.max():.1f} km")
    print(f"Sub-Earth latitude: min={sub_earth_lats.min():.2f}°, max={sub_earth_lats.max():.2f}°")

    assert np.allclose(sun_norms, 1.0, atol=1e-5), "sun_dir vectors are not unit vectors!"
    assert np.all((earth_dists >= 350000) & (earth_dists <= 415000)), "Earth distance out of range!"
    assert np.all(np.abs(sub_earth_lats) <= 7.5), "Sub-Earth latitude outside the ±7° range!"

    out_path = DATA_OUT / "ephem.bin"
    ephem.astype("<f4").tofile(out_path)
    print(f"\n[SUCCESS] Saved {out_path} ({out_path.stat().st_size} bytes, shape: {ephem.shape})")


if __name__ == "__main__":
    parts = []
    for year in YEARS:
        raw_csv = fetch_horizons_csv(year)
        col_headers, data_rows = extract_header_and_rows(raw_csv)
        expected = 8784 if calendar.isleap(year) else 8760
        print(f"Year {year}: {len(data_rows)} steps (expected {expected})")
        assert len(data_rows) == expected, f"Year {year}: expected {expected} steps, received {len(data_rows)}!"
        parts.append(parse_ephem(col_headers, data_rows))
    ephem = np.concatenate(parts)
    print(f"\nTotal {len(YEARS)} years: {ephem.shape[0]} steps")
    save_ephem(ephem)