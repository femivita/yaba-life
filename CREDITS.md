# Credits

## Map data

`public/data/yaba.bin` and `public/data/yaba.json` are derived from:

- **OpenStreetMap** © OpenStreetMap contributors, licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). The derived map database in `public/data/` is therefore also offered under the ODbL.
- Delivered through the **Overture Maps Foundation** release `2026-09-23.1` ([overturemaps.org](https://overturemaps.org)).
- Some building footprints in Overture come from **Google Open Buildings** (CC BY 4.0) and **Microsoft ML Building Footprints** (ODbL).
- Places of interest are from Overture's places theme (CDLA Permissive 2.0).

Building heights are mostly estimated from footprint size because OSM rarely records them in Yaba.

## Character

`public/models/*.glb` (Tunde, Iya Bisi, Amaka, Kemi, Chidi, Emeka, Baba the landlord and Mallam Sani) are generated from **MakeHuman** assets (base mesh, morph targets, skin, clothes, hair, eyes and eyebrows by the MakeHuman team and community), which are released under **CC0**. See the MakeHuman licence FAQ: "Targets, proxies and the base mesh are considered graphical assets, covered by CC0." The MakeHuman logo printed on the original t-shirt texture has been removed. Ankara prints are drawn procedurally by `tools/character/build_character.py`.

## Research

Yaba places, districts and daily-life notes come from the project's research document (`yaba-places.json`). Coordinates marked approximate were snapped to OpenStreetMap features where a match exists.

## Game design

The life-sim systems are inspired by The Sims (needs, moodlets, smart objects, rabbit-hole careers). No assets or code from The Sims are used. See `docs/life-sim-design.md` for sources.

## Code

All code in this repository is MIT licensed (see `LICENSE`). Three.js is MIT.
