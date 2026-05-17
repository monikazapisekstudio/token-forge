# Token Forge

Figma plugin for importing design tokens from code into Figma variables.

## Quick start

### For users

1. Install from Figma Community.
2. Prepare a JSON file with tokens in DTCG format or simple key-value.
3. Open Token Forge in Figma, paste JSON, set collection name.
4. Click **Import** — done.

### For developers

```bash
git clone https://github.com/monikazapisekstudio/token-forge.git
cd token-forge
npm install
npm run build
```

Test in Figma: **Plugins → Development → Import plugin from manifest...** → select `manifest.json`

## Features

- DTCG, flat JSON, CSS custom properties, Material Theme support
- Collections: create new or import to existing
- Aliases, Modes, Scope mapping
- Replace / Merge
- Auto-wrap flat tokens

## Supported formats

- **DTCG** — nested or flat, with $type and $value
- **Flat JSON** — key-value pairs, auto-wrapped
- **CSS custom properties** — --name: value
- **Material Theme Builder** — paste JSON directly

## License

MIT

## Support

Issues: https://github.com/monikazapisekstudio/token-forge/issues
Email: studio@monikazapisek.com
