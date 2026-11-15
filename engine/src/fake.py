"""FAKE ephemeris for testing only. Never write its output to data/out/.

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
import numpy as np


def u(lat_deg, lon_deg):
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


def fake_ephem(n_steps=8784):
    """FAKE: simplified Sun/Earth motion in the ephem.bin layout. Testing only."""
    d = np.arange(n_steps) / 24.0                                   # days
    sun_lat = 1.54 * np.sin(2 * np.pi * d / 346.6)                  # seasons
    sun_lon = (-360.0 * d / 29.53 + 180) % 360 - 180                # Sun moves west
    earth_lat = 6.68 * np.sin(2 * np.pi * d / 27.21)                # libration up/down
    earth_lon = 7.9 * np.sin(2 * np.pi * d / 27.55)                 # libration sideways
    return np.hstack([u(sun_lat, sun_lon), 384_400.0 * u(earth_lat, earth_lon)]).astype(np.float32)
