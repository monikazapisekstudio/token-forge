function postProgress(status, message, current, total) {
  current = current || 0;
  total = total || 0;
  figma.ui.postMessage({ type: "progress", status: status, message: message, current: current, total: total });
}

function parseErrorMessage(e) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

var SUPPORTED_SCOPES = {
  ALL_SCOPES: ["ALL_SCOPES"], FONT_FAMILY: ["FONT_FAMILY"], FONT_STYLE: ["FONT_STYLE"],
  FONT_SIZE: ["FONT_SIZE"], LINE_HEIGHT: ["LINE_HEIGHT"], LETTER_SPACING: ["LETTER_SPACING"],
  PARAGRAPH_SPACING: ["PARAGRAPH_SPACING"], PARAGRAPH_INDENT: ["PARAGRAPH_INDENT"],
  CORNER_RADIUS: ["CORNER_RADIUS"], WIDTH_HEIGHT: ["WIDTH_HEIGHT"], GAP: ["GAP"],
  STROKE_FLOAT: ["STROKE_FLOAT"], EFFECT_FLOAT: ["EFFECT_FLOAT"], OPACITY: ["OPACITY"],
  TEXT_CONTENT: ["TEXT_CONTENT"], FONT_VARIATIONS: ["FONT_VARIATIONS"]
};

function normalizeScopes(raw) {
  if (!raw || raw.length === 0) return ["ALL_SCOPES"];
  return raw.flatMap(function (s) { return SUPPORTED_SCOPES[s] || ["ALL_SCOPES"]; });
}

function normalizeVariableType(t) {
  switch (t.toLowerCase()) {
    case "color": return "COLOR";
    case "float": case "number": return "FLOAT";
    case "string": return "STRING";
    case "boolean": return "BOOLEAN";
    default: return "STRING";
  }
}

function hexToRgba(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (hex.length === 8) {
    return { r: parseInt(hex.slice(0,2),16)/255, g: parseInt(hex.slice(2,4),16)/255,
             b: parseInt(hex.slice(4,6),16)/255, a: parseInt(hex.slice(6,8),16)/255 };
  }
  return { r: parseInt(hex.slice(0,2),16)/255, g: parseInt(hex.slice(2,4),16)/255,
           b: parseInt(hex.slice(4,6),16)/255, a: 1 };
}

function resolveColorTokenValue(value, tokenMap, processed) {
  processed = processed || new Set();
  if (typeof value === "string") {
    if (value.startsWith("#") || value.startsWith("hsl")) return value;
    var alias = value.replace(/[{}]/g, "");
    if (processed.has(alias)) return "#000000";
    processed.add(alias);
    var refToken = tokenMap.get(alias);
    if (refToken && refToken.$type === "color") {
      return resolveColorTokenValue(refToken.$value, tokenMap, processed);
    }
    return "#000000";
  }
  if (typeof value === "object" && value !== null) {
    if (value.hex) return value.hex;
    if (value.components) {
      var r = value.components[0], g = value.components[1], b = value.components[2];
      var a = value.alpha != null ? value.alpha : 1;
      var toHex = function (n) { return Math.round(n * 255).toString(16).padStart(2, "0"); };
      return "#" + toHex(r) + toHex(g) + toHex(b) + (a < 1 ? toHex(a) : "");
    }
  }
  return "#000000";
}

function flattenTokens(obj, tokenMap, prefix) {
  prefix = prefix || "";
  if (!obj) return;
  Object.keys(obj).forEach(function (key) {
    var token = obj[key];
    if (token && typeof token === "object" && "$type" in token && "$value" in token) {
      tokenMap.set(prefix ? prefix + "/" + key : key, token);
    } else if (token && typeof token === "object") {
      flattenTokens(token, tokenMap, prefix ? prefix + "/" + key : key);
    }
  });
}

function stripJsonComments(str) {
  str = str.replace(/\/\*[\s\S]*?\*\//g, '');
  str = str.replace(/^\s*\/\/.*$/gm, '');
  return str;
}

figma.showUI(__html__, { width: 480, height: 760, themeColors: true });

figma.ui.onmessage = function (msg) {

  if (msg.type === "ping") {
    figma.ui.postMessage({ type: "pong" });
    return;
  }

  if (msg.type === "get-existing-collections") {
    figma.variables.getLocalVariableCollectionsAsync().then(function (collections) {
      var list = collections.map(function (c) {
        return { id: c.id, name: c.name,
          modes: c.modes.map(function (m) { return { modeId: m.modeId, name: m.name }; }) };
      });
      figma.ui.postMessage({ type: "existing-collections", collections: list });
    }).catch(function (e) {
      figma.ui.postMessage({ type: "existing-collections", collections: [], error: parseErrorMessage(e) });
    });
    return;
  }

  if (msg.type === "preview-json") {
    try {
      var raw = msg.payload;
      if (typeof raw === "string") raw = stripJsonComments(raw);
      var data;
      var wasAutoWrapped = false;

      // Detect CSS custom properties (scan all lines)
      if (typeof raw === "string" && raw.split("\n").some(function(l) { return /^\s*--[\w-]+\s*:/.test(l); })) {
        var cssTokens = {};
        raw.split(/[;\n]/).forEach(function (line) {
          var m = line.match(/^\s*--([\w-]+)\s*:\s*(.+)/);
          if (!m) return;
          var name = m[1].trim();
          var val = m[2].trim();
          var type = "string";
          if (/^#[0-9a-fA-F]{3,8}$/.test(val)) type = "color";
          else if (/^hsl\(/.test(val)) type = "color";
          else if (/^rgb/.test(val)) type = "color";
          else if (/^\d+(\.\d+)?$/.test(val)) type = "number";
          cssTokens[name] = { "$type": type, "$value": val };
        });
        if (Object.keys(cssTokens).length > 0) {
          data = { variables: { imported: { name: "Imported from CSS", tokens: cssTokens } } };
          wasAutoWrapped = true;
        }
      }

      if (!data) {
        data = typeof raw === "string" ? JSON.parse(stripJsonComments(raw)) : raw;
      }

      if (!data.variables) {
        // Detect Material Theme Builder format (schemes.light / schemes.dark)
        if (data.schemes && data.schemes.light && typeof data.schemes.light === "object") {
          var mtModes = Object.keys(data.schemes);
          var mtTokens = {};
          var allKeys = {};
          mtModes.forEach(function (mode) {
            Object.keys(data.schemes[mode]).forEach(function (k) {
              allKeys[k] = true;
            });
          });
          if (data.coreColors) {
            Object.keys(data.coreColors).forEach(function (k) { allKeys[k] = true; });
          }
          Object.keys(allKeys).forEach(function (k) {
            var modeVals = {};
            mtModes.forEach(function (mode) {
              var v = data.schemes[mode][k];
              if (v) modeVals[mode] = v;
            });
            if (data.coreColors && data.coreColors[k]) {
              var v = data.coreColors[k];
              var isColor = /^#[0-9a-fA-F]{3,8}$/.test(v);
              mtTokens[k] = { "$type": isColor ? "color" : "string", "$value": v, "$extensions": { "com.figma.modes": modeVals } };
            } else {
              mtTokens[k] = { "$type": "color", "$value": modeVals };
            }
          });
          data = { variables: { materialTheme: { name: data.description || "Material Theme", modes: mtModes, tokens: mtTokens } } };
          wasAutoWrapped = true;
        } else {
        var keys = Object.keys(data);
        var hasTokens = keys.some(function (k) {
          var v = data[k]; return v && typeof v === "object" && "$type" in v && "$value" in v;
        });
        var hasSimpleValues = keys.some(function (k) {
          return typeof data[k] === "string" || typeof data[k] === "number";
        });

        if (hasTokens) {
          data = { variables: { imported: { name: "Imported Tokens", tokens: data } } };
          wasAutoWrapped = true;
        } else if (hasSimpleValues && keys.length > 0) {
          var wrappedTokens = {};
          keys.forEach(function (k) {
            var val = data[k];
            var type = "string";
            if (typeof val === "number") type = "number";
            else if (typeof val === "string" && /^#[0-9a-fA-F]{3,8}$/.test(val)) type = "color";
            else if (typeof val === "string" && /^hsl\(/.test(val)) type = "color";
            wrappedTokens[k] = { "$type": type, "$value": val };
          });
          data = { variables: { imported: { name: "Imported Tokens", tokens: wrappedTokens } } };
          wasAutoWrapped = true;
        } else {
          figma.ui.postMessage({ type: "preview-result", error: "No 'variables' key and no detectable tokens." });
          return;
        }
        }
      }

      var previewCollections = [];
      function countTokens(obj) {
        var c = 0;
        function walk(o) {
          if (!o || typeof o !== "object") return;
          if (o.$type && "$value" in o) { c++; return; }
          Object.keys(o).forEach(function (k) { walk(o[k]); });
        }
        walk(obj); return c;
      }

      Object.keys(data.variables).forEach(function (key) {
        var c = data.variables[key];
        if (!c) return;
        var count = c.tokens ? countTokens(c.tokens) : 0;
        var modes = c.modes ? c.modes : [];
        previewCollections.push({ sourceKey: key, name: c.name || key, tokenCount: count, modes: modes, isModeBased: modes.length > 0 });
      });

      figma.ui.postMessage({ type: "preview-result", collections: previewCollections, wrappedData: data, autoWrapped: wasAutoWrapped });
    } catch (e) {
      figma.ui.postMessage({ type: "preview-result", error: "Invalid JSON: " + parseErrorMessage(e) });
    }
    return;
  }

  if (msg.type === "import-configured") {
    var importConfig = msg.config;
    var tokenData = msg.data;
    var allTokens = new Map();

    if (!tokenData || !tokenData.variables) {
      var rawData = tokenData;
      var rkeys = rawData ? Object.keys(rawData) : [];
      // Detect Material Theme Builder
      if (rawData && rawData.schemes && rawData.schemes.light && typeof rawData.schemes.light === "object") {
        var mtModes2 = Object.keys(rawData.schemes);
        var mtTokens2 = {};
        var allKeys2 = {};
        mtModes2.forEach(function (mode) {
          Object.keys(rawData.schemes[mode]).forEach(function (k) { allKeys2[k] = true; });
        });
        if (rawData.coreColors) Object.keys(rawData.coreColors).forEach(function (k) { allKeys2[k] = true; });
        Object.keys(allKeys2).forEach(function (k) {
          var modeVals = {};
          mtModes2.forEach(function (mode) { var v = rawData.schemes[mode][k]; if (v) modeVals[mode] = v; });
          if (rawData.coreColors && rawData.coreColors[k]) {
            var v = rawData.coreColors[k];
            mtTokens2[k] = { "$type": /^#/.test(v) ? "color" : "string", "$value": v, "$extensions": { "com.figma.modes": modeVals } };
          } else {
            mtTokens2[k] = { "$type": "color", "$value": modeVals };
          }
        });
        tokenData = { variables: { materialTheme: { name: rawData.description || "Material Theme", modes: mtModes2, tokens: mtTokens2 } } };
      } else if (rawData && rkeys.length > 0) {
        var hasTok = rkeys.some(function (k) {
          var v = rawData[k]; return v && typeof v === "object" && "$type" in v && "$value" in v;
        });
        if (hasTok) {
          tokenData = { variables: { imported: { name: "Imported Tokens", tokens: rawData } } };
        } else {
          var flat = {};
          rkeys.forEach(function (k) {
            var val = rawData[k];
            var t = "string";
            if (typeof val === "number") t = "number";
            else if (typeof val === "string" && /^#[0-9a-fA-F]{3,8}$/.test(val)) t = "color";
            else if (typeof val === "string" && /^hsl\(/.test(val)) t = "color";
            flat[k] = { "$type": t, "$value": val };
          });
          tokenData = { variables: { imported: { name: "Imported Tokens", tokens: flat } } };
        }
      } else {
        figma.ui.postMessage({ type: "import-done", success: false, error: "No token data" });
        return;
      }
    }

    figma.variables.getLocalVariableCollectionsAsync().then(function (allLocalCollections) {
      try {
        var missingCollections = [];
        var importErrors = [];
        importConfig.forEach(function (cfg) {
          if (cfg.targetType === "existing" && cfg.collectionId) {
            var found = allLocalCollections.some(function (c) { return c.id === cfg.collectionId; });
            if (!found) missingCollections.push(cfg.collectionId);
          }
        });
        if (missingCollections.length > 0) {
          figma.ui.postMessage({ type: "import-done", success: false, error: "Missing collections: " + missingCollections.join(", ") });
          return;
        }

        importConfig.forEach(function (cfg) {
        var source = tokenData.variables[cfg.sourceKey];
        if (!source) return;

        flattenTokens(source.tokens, allTokens, cfg.sourceKey);

        var collection;
        if (cfg.targetType === "existing" && cfg.collectionId) {
          var existingCol = allLocalCollections.find(function (c) { return c.id === cfg.collectionId; });
          if (!existingCol) throw new Error("Collection not found: " + cfg.collectionId);
          collection = existingCol;

          if (cfg.variableAction === "replace") {
            collection.variableIds.forEach(function (varId) { var v = figma.variables.getVariableById(varId); if (v) v.remove(); });
          }
          cfg.modes.forEach(function (mapping, mi) {
            if (mapping.targetType === "new") {
              var modeName = mapping.targetModeName;
              var exists = collection.modes.some(function (m) { return m.name === modeName; });
              if (!exists) {
                try { collection.addMode(modeName); } catch (e) {
                  figma.ui.postMessage({ type: "log", message: "Could not add mode \"" + modeName + "\" (limited to " + collection.modes.length + " mode on this plan). Values will use the default mode." });
                }
              }
            }
          });
        } else {
          var newName = cfg.collectionName || source.name || cfg.sourceKey;
          var existingNames = allLocalCollections.map(function(c){ return c.name; });
          var uniqueName = newName;
          var n = 2;
          while (existingNames.indexOf(uniqueName) >= 0) {
            uniqueName = newName + " (" + n + ")";
            n++;
          }
          collection = figma.variables.createVariableCollection(uniqueName);
          cfg.modes.forEach(function (mapping, mi) {
            if (collection.modes.length > mi) {
              collection.modes[mi].name = mapping.targetModeName || mapping.sourceMode;
            } else {
              try { collection.addMode(mapping.targetModeName || mapping.sourceMode); } catch (e) {
                figma.ui.postMessage({ type: "log", message: "Could not add mode \"" + (mapping.targetModeName || mapping.sourceMode) + "\" (limited to " + collection.modes.length + " mode on this plan). Values will use the default mode." });
              }
            }
          });
        }

        var modeIds = cfg.modes.map(function (m) {
          if (m.targetType === "use-default") return collection.modes[0] ? collection.modes[0].modeId : null;
          var targetName = m.targetModeName || m.sourceMode;
          for (var i = 0; i < collection.modes.length; i++) {
            if (collection.modes[i].name === targetName) return collection.modes[i].modeId;
          }
          return null;
        });
        if (modeIds.length === 0 && collection.modes.length > 0) modeIds = [collection.modes[0].modeId];

        var existingVars = {};
        if (cfg.variableAction === "merge" && cfg.targetType === "existing") {
          collection.variableIds.forEach(function (varId) { var v = figma.variables.getVariableById(varId); if (v) existingVars[v.name] = v; });
        }

        postProgress("creating-variables", "Importing " + cfg.sourceKey + "...", 0, 1);

        function createVars(obj, parentName, modeIdsArr, isColorCollection) {
          parentName = parentName || "";
          Object.keys(obj).forEach(function (key) {
            var token = obj[key];
            if (token && typeof token === "object" && "$type" in token && "$value" in token) {
              var fullName = parentName ? parentName + "/" + key : key;
              try {
                if (cfg.variableAction === "merge" && existingVars[fullName]) {
                  updateVariableValues(existingVars[fullName], token, modeIdsArr);
                  return;
                }
                var varType = normalizeVariableType(token.$type);
                var variable = figma.variables.createVariable(fullName, collection, varType);
                if (token.$description) variable.description = token.$description;
                if (token.$extensions && token.$extensions["com.figma.scopes"] && varType === "STRING") {
                  variable.scopes = normalizeScopes(token.$extensions["com.figma.scopes"]);
                }
                modeIdsArr.forEach(function (modeId, mi) {
                  if (!modeId) return;
                  var val = token.$value;
                  if (isColorCollection && cfg.modes[mi] && token.$extensions && token.$extensions["com.figma.modes"] && source.modes && source.modes[mi]) {
                    var modeVal = token.$extensions["com.figma.modes"][source.modes[mi]];
                    if (modeVal) val = modeVal;
                  }
                  if (typeof val === "object" && val !== null && !val.hex && !val.components) {
                    var modeName = cfg.modes[mi] ? (cfg.modes[mi].targetModeName || cfg.modes[mi].sourceMode) : null;
                    if (modeName) {
                      var modeKeys = Object.keys(val);
                      for (var mk = 0; mk < modeKeys.length; mk++) {
                        if (modeKeys[mk].toLowerCase() === modeName.toLowerCase()) { val = val[modeKeys[mk]]; break; }
                      }
                    }
                  }
                  if (varType === "STRING") variable.setValueForMode(modeId, String(val));
                  else if (varType === "FLOAT") variable.setValueForMode(modeId, Number(val));
                  else if (varType === "BOOLEAN") variable.setValueForMode(modeId, Boolean(val));
                  else if (varType === "COLOR") {
                    var resolved = resolveColorTokenValue(val, allTokens);
                    if (typeof resolved === "string" && resolved.startsWith("#")) {
                      var rgba = hexToRgba(resolved);
                      variable.setValueForMode(modeId, { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a });
                    }
                  }
                });
              } catch (e) { importErrors.push(fullName + ": " + parseErrorMessage(e)); }
            } else if (token && typeof token === "object") {
              createVars(token, parentName ? parentName + "/" + key : key, modeIdsArr, isColorCollection);
            }
          });
        }

        function updateVariableValues(variable, token, modeIdsArr) {
          var varType = variable.resolvedType;
          modeIdsArr.forEach(function (modeId, mi) {
            if (!modeId) return;
            var val = token.$value;
            if (typeof val === "object" && val !== null && !val.hex && !val.components) {
              var modeName = cfg.modes[mi] ? (cfg.modes[mi].targetModeName || cfg.modes[mi].sourceMode) : null;
              if (modeName) {
                var modeKeys = Object.keys(val);
                for (var mk = 0; mk < modeKeys.length; mk++) {
                  if (modeKeys[mk].toLowerCase() === modeName.toLowerCase()) { val = val[modeKeys[mk]]; break; }
                }
              }
            }
            if (varType === "STRING") variable.setValueForMode(modeId, String(val));
            else if (varType === "FLOAT") variable.setValueForMode(modeId, Number(val));
            else if (varType === "BOOLEAN") variable.setValueForMode(modeId, Boolean(val));
            else if (varType === "COLOR") {
              var resolved = resolveColorTokenValue(val, allTokens);
              if (typeof resolved === "string" && resolved.startsWith("#")) {
                var rgba = hexToRgba(resolved);
                variable.setValueForMode(modeId, { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a });
              }
            }
          });
        }

        createVars(source.tokens, "", modeIds, source.modes && source.modes.length > 0);
      });

      postProgress("done", "Import complete. All variables created.");
      figma.ui.postMessage({ type: "import-done", success: true, count: allTokens.size, errors: importErrors });

    } catch (e) {
      postProgress("error", "Import failed: " + parseErrorMessage(e));
      figma.ui.postMessage({ type: "import-done", success: false, error: parseErrorMessage(e) });
    }
    }).catch(function (e) {
      postProgress("error", "Async failed: " + parseErrorMessage(e));
      figma.ui.postMessage({ type: "import-done", success: false, error: parseErrorMessage(e) });
    });
  }

  if (msg.type === "close") { figma.closePlugin(); }
  if (msg.type === "resize") { figma.ui.resize(msg.width || 480, msg.height || 660); }
};
