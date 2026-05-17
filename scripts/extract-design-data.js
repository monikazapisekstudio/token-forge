const fs = require("fs");
const path = require("path");

const PROTOTYPE_ROOT = path.resolve(__dirname, "../../../client/windly-workspace/windly-app-prototype");
const TOKENS_DIR = path.join(PROTOTYPE_ROOT, "tokens", "figma");
const COMPONENTS_DIR = path.join(PROTOTYPE_ROOT, "src", "app", "components");
const PAGES_DIR = path.join(PROTOTYPE_ROOT, "src", "app", "pages");
const OUTPUT = path.resolve(__dirname, "../design-data.json");

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function mergeTokens() {
  const variables = {};

  const colorModeTokens = readJSON(path.join(TOKENS_DIR, "3-color-modes", "Light.tokens.json"));
  const darkModeTokens = readJSON(path.join(TOKENS_DIR, "3-color-modes", "Dark.tokens.json"));

  if (colorModeTokens) {
    variables.colorModes = {
      name: "Color Modes",
      modes: ["Light", "Dark"],
      tokens: colorModeTokens,
    };

    if (darkModeTokens) {
      const mergedTokens = { ...colorModeTokens };
      for (const [key, value] of Object.entries(darkModeTokens)) {
        if (typeof value === "object" && value !== null && "$value" in value) {
          const lightVal = mergedTokens[key];
          if (lightVal && typeof lightVal === "object" && "$value" in lightVal) {
            mergedTokens[key] = {
              ...lightVal,
              $value: { Light: lightVal.$value, Dark: value.$value },
            };
          }
        }
      }
      variables.colorModes.tokens = mergedTokens;
    }
  }

  const themeTokens = readJSON(path.join(TOKENS_DIR, "2-theme", "Default.tokens.json"));
  if (themeTokens) {
    variables.theme = {
      name: "Theme",
      tokens: themeTokens,
    };
  }

  const md3Tokens = readJSON(path.join(TOKENS_DIR, "4-md3-tonal-pallettes", "Default.tokens.json"));
  if (md3Tokens) {
    variables.md3 = {
      name: "MD3 Tonal Palettes",
      tokens: md3Tokens,
    };
  }

  const tailwindTokens = readJSON(path.join(TOKENS_DIR, "1-tailwindcss", "Default.tokens.json"));
  if (tailwindTokens) {
    variables.tailwind = {
      name: "Tailwind",
      tokens: tailwindTokens,
    };
  }

  return variables;
}

function readDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function readTSXFilesRecursive(dir) {
  const results = [];
  const entries = readDir(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...readTSXFilesRecursive(fullPath));
      } else if (entry.endsWith(".tsx")) {
        results.push({ name: entry, path: fullPath });
      }
    } catch {}
  }
  return results;
}

function extractComponentDef(compDir) {
  const files = readTSXFilesRecursive(compDir);
  const defs = [];

  for (const { name: file, path: filePath } of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const name = file.replace(".tsx", "");

      const propsMatch = content.match(/interface\s+(\w+Props)/);
      const variantMatch = content.match(/(\w+)Variants\s*=\s*cva\(/);
      const props = {};

      if (variantMatch) {
        const cvaContent = content.split(variantMatch[0])[1];
        const variantBlocks = cvaContent.match(/variants:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
        if (variantBlocks) {
          const varBody = variantBlocks[1];
          const variantPairs = varBody.match(/(\w+):\s*\{[^}]+\}/g);
          if (variantPairs) {
            for (const pair of variantPairs) {
              const key = pair.match(/^(\w+):/)?.[1];
              const values = pair.match(/\b(\w+):\s*["'`]([^"'`]+)["'`]/g);
              if (key && values) {
                props[key] = values.map((v) => v.match(/:\s*["'`]([^"'`]+)["'`]/)?.[1]).filter(Boolean);
              }
            }
          }
        }
      }

      const typeMatch = content.match(/export\s+(?:default\s+)?function\s+(\w+)/);
      if (typeMatch && typeMatch[1] !== name) {
        continue;
      }

      const tailwindClasses = content.match(/className="([^"]{3,})"/g) || [];
      const tokensUsed = new Set();
      for (const cls of tailwindClasses) {
        const classes = cls.match(/"([^"]+)"/)?.[1]?.split(/\s+/) || [];
        for (const c of classes) {
          if (c.startsWith("bg-") || c.startsWith("text-") || c.startsWith("border-") ||
              c.startsWith("shadow-") || c.startsWith("rounded-") || c.startsWith("p-") ||
              c.startsWith("m-") || c.startsWith("gap-") || c.startsWith("text-[")) {
            tokensUsed.add(c.replace(/[\[\]]/g, ""));
          }
        }
      }

      defs.push({
        name,
        source: filePath.replace(PROTOTYPE_ROOT, ""),
        hasVariants: !!variantMatch,
        variantProps: props,
        tokenPatterns: [...tokensUsed].slice(0, 20),
      });
    } catch {
      // skip unreadable files
    }
  }
  return defs;
}

function extractPages() {
  const files = readTSXFilesRecursive(PAGES_DIR);
  const pages = [];

  for (const { name: file, path: filePath } of files) {    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const titleMatch = content.match(/title:\s*["'`]([^"'`]+)["'`]/) || content.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const name = file.replace(".tsx", "");
      pages.push({
        name: titleMatch ? titleMatch[1] : name,
        file,
        source: filePath.replace(PROTOTYPE_ROOT, ""),
      });
    } catch {
      // skip
    }
  }
  return pages;
}

console.log("Extracting design data from Windly prototype...");

const variables = mergeTokens();
console.log(`  Variables: ${Object.keys(variables).length} collections`);

const uiDefs = extractComponentDef(path.join(COMPONENTS_DIR, "ui"));
const customDefs = extractComponentDef(path.join(COMPONENTS_DIR, "custom"));
const contentDefs = extractComponentDef(path.join(COMPONENTS_DIR, "content"));
const layoutDefs = extractComponentDef(path.join(COMPONENTS_DIR, "layout"));
const allComponents = [...uiDefs, ...customDefs, ...contentDefs, ...layoutDefs];
console.log(`  Components: ${allComponents.length} (${uiDefs.length} ui, ${customDefs.length} custom, ${contentDefs.length} content, ${layoutDefs.length} layout)`);

const pages = extractPages();
console.log(`  Pages: ${pages.length}`);

const designData = {
  version: "1.0",
  generated: new Date().toISOString(),
  source: "windly-app-prototype",
  variables,
  components: allComponents.length > 0 ? allComponents : undefined,
  pages: pages.length > 0 ? pages : undefined,
  stats: {
    variableCollections: Object.keys(variables).length,
    components: allComponents.length,
    pages: pages.length,
  },
};

fs.writeFileSync(OUTPUT, JSON.stringify(designData, null, 2), "utf-8");
console.log(`\nDone! Output: ${OUTPUT}`);
console.log(`  Variable collections: ${designData.stats.variableCollections}`);
console.log(`  Components extracted: ${designData.stats.components}`);
console.log(`  Pages extracted: ${designData.stats.pages}`);
