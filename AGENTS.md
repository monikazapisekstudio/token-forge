# Token Forge — Agent Context

## Repository structure

```
token-forge/
├── AGENTS.md          # THIS FILE — agent instructions
├── README.md          # Plugin description and usage
├── manifest.json      # Figma plugin manifest
├── code.js            # Plugin sandbox code (Figma API)
├── ui.html            # Plugin UI (HTML/CSS/JS)
├── package.json       # Node dependencies (TypeScript typings)
├── tsconfig.json      # TypeScript config
├── scripts/           # Node.js extractor (optional)
├── sample data/       # Example DTCG, CSS, and JSON files
└── .gitignore
```

## Key files

- `manifest.json` — plugin ID, name, editor type, permissions
- `code.js` — main plugin logic: detects format, creates variables, handles modes
- `ui.html` — user interface with custom dropdowns, cards, alerts, validation

## Publishing

- Figma Community: publish from Figma Desktop (Plugins → Development → Token Forge → Publish)
- GitHub: https://github.com/monikazapisekstudio/token-forge
- Support: studio@monikazapisek.com
