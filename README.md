# Forever Route Planner

Plan questing routes for **WoW: Forever** on an interactive map of Azeroth, then export them as **RestedXP** guides.

- Quest givers, objectives and turn-ins from the Questie database, with XP tracking that unlocks quests as you level
- Walking routes that follow the terrain, flight paths, zeppelins, boats and the Deeprun Tram
- Import RestedXP guides, join and leave them from your own route, and export the result with every guide step kept exactly as written
- Everything runs in your browser; routes are saved locally and can be shared as route files

## Use it

Open `index.html` in a browser, or host this folder on any static web host (see below). No server or build step is needed to run it.

## Host it on GitHub Pages

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute the planner is live at `https://<your-username>.github.io/<repository-name>/`.

The `tiles/` folder must sit next to `index.html`; it holds the close-up terrain shading.

## Change it

The page is assembled from `src/` and `data/`:

```
python3 build.py      # writes index.html from src/shell_head.html, src/app.js, src/nav.js, src/shell_tail.html and data/bundle.b64
```

- `src/app.js` – planner logic, map drawing, RestedXP import/export
- `src/nav.js` – flight paths, transports and terrain path-finding
- `data/bundle.b64` – gzip + base64 JSON with the quest database and map data
- `tools/` – the Python/Lua scripts used to generate the map, terrain and flight data (they expect local copies of QuestieDB and of terrain files exported from the game with `tools/adt_to_terrain.py`)

## Licence

The planner is free software under the **GNU General Public License v3.0** (see `LICENSE`).

### Credits and third-party material

- **Quest, NPC, item and object data** come from [Questie](https://github.com/Questie/Questie) via [QuestieDB](https://github.com/Questie/QuestieDB), licensed GPL-3.0. Many thanks to their contributors.
- **RestedXP guides are not included.** Users import their own copies. Guides remain under RestedXP's licence ([CC BY-NC-SA 4.0](https://github.com/RestedXP/RXPGuides)); exported routes that contain guide text carry that licence too, and the exporter adds a note saying so.
- **Map and terrain data** (zone outlines, coastlines, terrain shading, walkability) are derived from World of Warcraft game files and are the property of Blizzard Entertainment. They are not covered by the GPL.
- **Flight path** nodes are Questie's flight masters; connections and flight times are estimates calculated from distance.

This project is not affiliated with or endorsed by Blizzard Entertainment, RestedXP or WoW: Forever.
