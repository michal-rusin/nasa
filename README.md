# ZetaIT Lunar Landing Site Navigator
ZetaIT Lunar Landing Site Navigator is an interactive web app that helps mission planners choose where to land near the Moon's south pole (84–90°S). For 40,316 candidate points (a 2 km grid plus 250 m refinement around the best areas) we computed a 360° horizon mask from LOLA elevation models and simulated ten years, 2028–2037, hour by hour, using Sun and Earth positions from JPL Horizons. Each point gets the metrics that decide whether a lander survives: share of time in sunlight, longest night, Earth visibility for direct communication, longest communication gap, solar panel power, terrain slope and distance to the nearest permanently shadowed region. Users set their own weights and filters to rank sites, click any point to see a sky panorama from the surface with the real horizon and a timeline of sunlight and Earth visibility, compare two sites side by side, and check 29 named places, including Artemis candidate regions and the IM-2 CLPS landing site. The tool turns raw terrain and ephemeris data into answers about power, communication and safety, so trade-offs between sites are visible at a glance.

## Use of AI

The code and documentation in this repository were written with AI assistance
(Claude Code and other AI assistants) and reviewed and tested by the team.

[ZetaIT Lunar Navigator.](https://michal-rusin.github.io/nasa/)
