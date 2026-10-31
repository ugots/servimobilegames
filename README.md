# ServiMobileGames hub

Static GitHub Pages site for ServiMobileGames: a landing page (`index.html`, built from
`games.json`) plus seven web games and the shared `_base/` code they import.

## Republish
1. Run `python tools\publish_hub.py` (copies `_base` and the game folders from the source repo, minus dev files).
2. `git add -A`, commit, and push to `main`. The Pages workflow deploys automatically.

## Placeholders
The Google Play package ids (`com.servimobilegames.*`) and the developer id
(`PLACEHOLDER_DEV_ID`) in `games.json` are placeholders. Replace them once the apps exist on Play.

## Source
Game source lives in the repo `ugots/games`. Do not edit the copied game folders here.
