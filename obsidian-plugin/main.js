var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  OCR_PROOFER_VIEW_TYPE: () => OCR_PROOFER_VIEW_TYPE,
  OcrProoferView: () => OcrProoferView,
  default: () => OcrProoferPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core/settings.ts
var DEFAULT_RESOLVER_SETTINGS = {
  frontmatterKeys: {
    image: "ocr_image",
    ocrData: "ocr_data",
    correctionLog: "correction_log"
  },
  resolutionPriority: ["body-callout", "frontmatter", "basename", "folder-scan"],
  required: {
    image: true,
    ocrData: true,
    correctionLog: false
  }
};

// src/obsidian/obsidian-vault-adapter.ts
var ObsidianVaultAdapter = class {
  constructor(app) {
    this.app = app;
  }
  getFiles() {
    return this.app.vault.getFiles();
  }
  getFileByPath(path) {
    return this.app.vault.getFileByPath(path);
  }
  resolveLink(linktext, sourcePath) {
    return this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
  }
  getFrontmatter(file) {
    var _a, _b;
    const tfile = this.app.vault.getFileByPath(file.path);
    if (!tfile) return null;
    return (_b = (_a = this.app.metadataCache.getFileCache(tfile)) == null ? void 0 : _a.frontmatter) != null ? _b : null;
  }
  async getFileContent(file) {
    const tfile = this.app.vault.getFileByPath(file.path);
    if (!tfile) return null;
    return this.app.vault.cachedRead(tfile);
  }
};

// src/core/constants.ts
var IMAGE_EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "tif", "tiff", "webp", "gif"]);
var OCR_DATA_EXTS = /* @__PURE__ */ new Set(["json"]);
var CORRECTION_LOG_EXTS = /* @__PURE__ */ new Set(["csv", "log"]);
var FALLBACK_IMAGE_KEYS = ["image", "source_image"];
var FALLBACK_OCR_KEYS = ["ocr_json", "ocr_result"];
var FALLBACK_LOG_KEYS = ["ocr_log", "log"];

// src/core/resolution-strategy.ts
var RE_IMAGE = /!\[\[(.*?)(?:\|.*?)?\]\]/;
var RE_OCR_HEADER = />\s*\[!ocr\]/i;
function isSameFile(a, b) {
  return a.path === b.path;
}
var DefaultResolutionStrategy = class {
  constructor(settings = DEFAULT_RESOLVER_SETTINGS) {
    this.settings = settings;
  }
  get imageKeys() {
    const p = this.settings.frontmatterKeys.image;
    return [p, ...FALLBACK_IMAGE_KEYS.filter((k) => k !== p)];
  }
  get ocrKeys() {
    const p = this.settings.frontmatterKeys.ocrData;
    return [p, ...FALLBACK_OCR_KEYS.filter((k) => k !== p)];
  }
  get logKeys() {
    const p = this.settings.frontmatterKeys.correctionLog;
    return [p, ...FALLBACK_LOG_KEYS.filter((k) => k !== p)];
  }
  async resolve(adapter, file) {
    for (const step of this.settings.resolutionPriority) {
      const result = await this.tryStep(step, adapter, file);
      if (result !== null) return result;
    }
    return this.buildNoneResult(file);
  }
  async tryStep(step, adapter, file) {
    switch (step) {
      case "body-callout":
        return this.tryBodyCallout(adapter, file);
      case "frontmatter":
        return this.tryFrontmatter(adapter, file);
      case "basename":
        return this.tryBasename(adapter, file);
      case "folder-scan":
        return this.tryFolderScan(adapter, file);
    }
  }
  // ── Primary: body WikiLink images + [!ocr] callouts ──────────────────────────
  //
  // Mirrors backend text_processor.OCRTextProcessor.extract_ocr_pages().
  // Returns null when the note contains no image WikiLinks (fallback proceeds).
  async tryBodyCallout(adapter, file) {
    var _a, _b;
    let content;
    try {
      content = await adapter.getFileContent(file);
    } catch (e) {
      return null;
    }
    if (!content) return null;
    const pages = this.parsePages(adapter, file, content);
    if (pages.length === 0) return null;
    const missing = [];
    if (pages.some((p) => p.imageFile === null)) missing.push("image");
    if (pages.some((p) => !p.ocrText)) missing.push("ocr-text");
    return {
      sourceFile: file,
      pages,
      imageFile: (_b = (_a = pages[0]) == null ? void 0 : _a.imageFile) != null ? _b : null,
      ocrDataFile: null,
      correctionLogFile: null,
      resolutionMethod: "body-callout",
      confidence: missing.length === 0 ? "high" : "medium",
      missing
    };
  }
  // Parse body lines into OcrPage[].  Logic mirrors the backend algorithm.
  parsePages(adapter, file, content) {
    var _a;
    const lines = content.split("\n");
    const pages = [];
    let i = 0;
    while (i < lines.length) {
      const imgMatch = RE_IMAGE.exec(lines[i]);
      if (imgMatch) {
        const linktext = imgMatch[1].trim();
        const imageFile = (_a = adapter.resolveLink(linktext, file.path)) != null ? _a : adapter.getFileByPath(linktext);
        let ocrText = null;
        let foundOcr = false;
        let j = i + 1;
        while (j < lines.length) {
          const stripped = lines[j].trim();
          if (RE_OCR_HEADER.test(lines[j])) {
            foundOcr = true;
            j++;
            const ocrLines = [];
            while (j < lines.length) {
              const s = lines[j].trim();
              if (s.startsWith(">")) {
                ocrLines.push(s.slice(1).trim());
                j++;
              } else if (s === "") {
                j++;
              } else {
                break;
              }
            }
            ocrText = ocrLines.join("\n").trim();
            break;
          } else if (stripped === "") {
            j++;
          } else if (RE_IMAGE.test(lines[j])) {
            break;
          } else {
            break;
          }
        }
        pages.push({
          page: pages.length + 1,
          imageFile,
          ocrText
        });
        i = foundOcr ? j : i + 1;
      } else {
        i++;
      }
    }
    return pages;
  }
  // ── Fallback: frontmatter ─────────────────────────────────────────────────────
  //
  // Step 1 — explicit frontmatter wins unconditionally.
  tryFrontmatter(adapter, file) {
    const fm = adapter.getFrontmatter(file);
    if (!fm) return null;
    const imageFile = this.lookupByKeys(adapter, file, this.imageKeys);
    const ocrDataFile = this.lookupByKeys(adapter, file, this.ocrKeys);
    const correctionLogFile = this.lookupByKeys(adapter, file, this.logKeys);
    if (!imageFile && !ocrDataFile && !correctionLogFile) return null;
    const missing = collectMissing(imageFile, ocrDataFile, correctionLogFile);
    const pages = buildLegacyPages(imageFile);
    return {
      sourceFile: file,
      pages,
      imageFile,
      ocrDataFile,
      correctionLogFile,
      resolutionMethod: "frontmatter",
      confidence: imageFile !== null && ocrDataFile !== null ? "high" : "medium",
      missing
    };
  }
  lookupByKeys(adapter, file, keys) {
    const fm = adapter.getFrontmatter(file);
    if (!fm) return null;
    for (const key of keys) {
      const val = fm[key];
      if (typeof val !== "string") continue;
      const found = lookupVaultFile(adapter, val, file.path);
      if (found) return found;
    }
    return null;
  }
  // Step 2 — same basename, same folder (e.g. doc.md → doc.json, doc.png).
  tryBasename(adapter, file) {
    var _a, _b, _c, _d, _e;
    const folderPath = (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const matched = adapter.getFiles().filter(
      (f) => {
        var _a2;
        return !isSameFile(f, file) && ((_a2 = f.parent) == null ? void 0 : _a2.path) === folderPath && f.basename === file.basename;
      }
    );
    if (matched.length === 0) return null;
    const imageFile = (_c = matched.find((f) => IMAGE_EXTS.has(f.extension))) != null ? _c : null;
    const ocrDataFile = (_d = matched.find((f) => OCR_DATA_EXTS.has(f.extension))) != null ? _d : null;
    const correctionLogFile = (_e = matched.find((f) => CORRECTION_LOG_EXTS.has(f.extension))) != null ? _e : null;
    const missing = collectMissing(imageFile, ocrDataFile, correctionLogFile);
    const pages = buildLegacyPages(imageFile);
    return {
      sourceFile: file,
      pages,
      imageFile,
      ocrDataFile,
      correctionLogFile,
      resolutionMethod: "basename",
      confidence: imageFile !== null && ocrDataFile !== null ? "high" : "medium",
      missing
    };
  }
  // Step 3 — any file in the same folder with a recognised extension.
  //          Low confidence: at most one candidate per slot is picked.
  //          Always returns a result (acts as the terminal step in the priority chain).
  tryFolderScan(adapter, file) {
    var _a, _b, _c, _d, _e;
    const folderPath = (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const siblings = adapter.getFiles().filter(
      (f) => {
        var _a2;
        return !isSameFile(f, file) && ((_a2 = f.parent) == null ? void 0 : _a2.path) === folderPath;
      }
    );
    const imageFile = (_c = siblings.find((f) => IMAGE_EXTS.has(f.extension))) != null ? _c : null;
    const ocrDataFile = (_d = siblings.find((f) => OCR_DATA_EXTS.has(f.extension))) != null ? _d : null;
    const correctionLogFile = (_e = siblings.find((f) => CORRECTION_LOG_EXTS.has(f.extension))) != null ? _e : null;
    const missing = collectMissing(imageFile, ocrDataFile, correctionLogFile);
    const pages = buildLegacyPages(imageFile);
    return {
      sourceFile: file,
      pages,
      imageFile,
      ocrDataFile,
      correctionLogFile,
      resolutionMethod: missing.length === 3 ? "none" : "folder-scan",
      confidence: "low",
      missing
    };
  }
  buildNoneResult(file) {
    return {
      sourceFile: file,
      pages: [],
      imageFile: null,
      ocrDataFile: null,
      correctionLogFile: null,
      resolutionMethod: "none",
      confidence: "low",
      missing: ["image", "ocr-data", "correction-log"]
    };
  }
};
function buildLegacyPages(imageFile) {
  if (!imageFile) return [];
  return [{ page: 1, imageFile, ocrText: null }];
}
function lookupVaultFile(adapter, raw, sourcePath) {
  var _a;
  const clean = raw.replace(/^\[\[|\]\]$/g, "").trim();
  return (_a = adapter.getFileByPath(clean)) != null ? _a : adapter.resolveLink(clean, sourcePath);
}
function collectMissing(imageFile, ocrDataFile, correctionLogFile) {
  const out = [];
  if (!imageFile) out.push("image");
  if (!ocrDataFile) out.push("ocr-data");
  if (!correctionLogFile) out.push("correction-log");
  return out;
}

// src/obsidian/ocr-document-resolver.ts
var OcrDocumentResolver = class {
  constructor(strategy = new DefaultResolutionStrategy()) {
    this.strategy = strategy;
  }
  resolve(app, file) {
    return this.strategy.resolve(new ObsidianVaultAdapter(app), file);
  }
};

// main.ts
var OCR_PROOFER_VIEW_TYPE = "ocr-proofer-view";
var SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set(["md", "txt", "json"]);
var DEFAULT_SETTINGS = {
  resolver: DEFAULT_RESOLVER_SETTINGS,
  serverUrl: "http://localhost:8000",
  launchMode: "reuse-existing"
};
var PlaceholderDocumentOpenService = class {
  openDocumentByPath(_path) {
  }
  openDocumentSet(_set) {
  }
};
var OcrProoferView = class extends import_obsidian.ItemView {
  constructor(leaf, openService) {
    super(leaf);
    this.openService = openService;
  }
  getViewType() {
    return OCR_PROOFER_VIEW_TYPE;
  }
  getDisplayText() {
    return "OCR Proofer";
  }
  getIcon() {
    return "scan-text";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ocr-proofer-view");
    const placeholder = container.createDiv({ cls: "ocr-proofer-placeholder" });
    placeholder.createEl("p", { text: "OCR Proofer" });
    placeholder.createEl("p", {
      cls: "ocr-proofer-placeholder__sub",
      text: "React UI \u3092\u3053\u3053\u306B\u30DE\u30A6\u30F3\u30C8\u3057\u307E\u3059\uFF08\u5C06\u6765\u5B9F\u88C5\uFF09"
    });
  }
  async onClose() {
  }
  // Called by the plugin open pipeline after OCR set resolution.
  openDocument(docSet) {
    var _a, _b;
    this.openService.openDocumentByPath(docSet.sourceFile.path);
    (_b = (_a = this.openService).openDocumentSet) == null ? void 0 : _b.call(_a, docSet);
  }
};
var OcrProoferPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.openService = new PlaceholderDocumentOpenService();
    this.resolver = new OcrDocumentResolver();
  }
  async onload() {
    await this.loadSettings();
    this.registerView(
      OCR_PROOFER_VIEW_TYPE,
      (leaf) => new OcrProoferView(leaf, this.openService)
    );
    this.addRibbonIcon("scan-text", "Open OCR Proofer", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-ocr-proofer",
      name: "Open OCR Proofer",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "open-active-file-in-ocr-proofer",
      name: "Open active file in OCR Proofer",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new import_obsidian.Notice("OCR Proofer: \u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30D5\u30A1\u30A4\u30EB\u304C\u3042\u308A\u307E\u305B\u3093\u3002");
          return;
        }
        this.openFileInProofer(file);
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (!(abstractFile instanceof import_obsidian.TFile)) return;
        if (!SUPPORTED_EXTENSIONS.has(abstractFile.extension)) return;
        const file = abstractFile;
        menu.addItem((item) => {
          item.setTitle("Open in OCR Proofer").setIcon("scan-text").onClick(() => this.openFileInProofer(file));
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, info) => {
        const file = info instanceof import_obsidian.MarkdownView ? info.file : info.file;
        if (!file) return;
        if (!SUPPORTED_EXTENSIONS.has(file.extension)) return;
        menu.addItem((item) => {
          item.setTitle("Open current file in OCR Proofer").setIcon("scan-text").onClick(() => this.openFileInProofer(file));
        });
      })
    );
    this.addSettingTab(new OcrProoferSettingTab(this.app, this));
  }
  async onunload() {
  }
  // ── Settings management ───────────────────────────────────────────────────
  async loadSettings() {
    var _a, _b, _c, _d, _e;
    const saved = (_a = await this.loadData()) != null ? _a : {};
    const savedResolver = (_b = saved.resolver) != null ? _b : {};
    this.settings = {
      resolver: {
        frontmatterKeys: {
          ...DEFAULT_RESOLVER_SETTINGS.frontmatterKeys,
          ...(_c = savedResolver.frontmatterKeys) != null ? _c : {}
        },
        resolutionPriority: (_d = savedResolver.resolutionPriority) != null ? _d : DEFAULT_RESOLVER_SETTINGS.resolutionPriority,
        required: {
          ...DEFAULT_RESOLVER_SETTINGS.required,
          ...(_e = savedResolver.required) != null ? _e : {}
        }
      },
      serverUrl: typeof saved.serverUrl === "string" && saved.serverUrl ? saved.serverUrl : DEFAULT_SETTINGS.serverUrl,
      launchMode: saved.launchMode === "reuse-existing" || saved.launchMode === "always-new" ? saved.launchMode : DEFAULT_SETTINGS.launchMode
    };
    this.rebuildResolver();
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.rebuildResolver();
  }
  rebuildResolver() {
    this.resolver = new OcrDocumentResolver(
      new DefaultResolutionStrategy(this.settings.resolver)
    );
  }
  // ── Leaf activation ───────────────────────────────────────────────────────
  async activateView() {
    var _a;
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(OCR_PROOFER_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return existing[0].view;
    }
    const leaf = (_a = workspace.getRightLeaf(false)) != null ? _a : workspace.getLeaf(true);
    await leaf.setViewState({ type: OCR_PROOFER_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
    return leaf.view;
  }
  // ── Web app opening ───────────────────────────────────────────────────────
  //
  // Dispatches to the running proofreading web app based on launchMode:
  //   reuse-existing  – use SSE bridge; fall back to new tab when no client is listening.
  //   always-new      – always open a new browser tab.
  async openInWebApp(file) {
    const note = file.path;
    const serverUrl = this.settings.serverUrl.replace(/\/$/, "");
    const newTabUrl = `${serverUrl}/?note=${encodeURIComponent(note)}`;
    if (this.settings.launchMode === "always-new") {
      try {
        const checkResp = await fetch(`${serverUrl}/api/bridge/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vault: this.app.vault.getName(),
            note,
            name: file.name,
            mode: "check-same-note"
          })
        });
        if (checkResp.ok) {
          const checkData = await checkResp.json();
          if (checkData.found) {
            const confirmed = await showConfirmModal(this.app, file.name);
            if (!confirmed) return;
            const resp = await fetch(`${serverUrl}/api/bridge/open`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                vault: this.app.vault.getName(),
                note,
                name: file.name,
                mode: "reuse-same-note"
              })
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data.delivered) {
                new import_obsidian.Notice("\u540C\u3058\u30CE\u30FC\u30C8\u304C\u65E2\u306B\u958B\u304B\u308C\u3066\u3044\u308B\u30BF\u30D6\u306B\u5207\u308A\u66FF\u3048\u307E\u3057\u305F\u3002");
                return;
              }
            }
          }
        }
      } catch (e) {
      }
      window.open(newTabUrl, "_blank");
      new import_obsidian.Notice("\u5F71\u5370\u6821\u30A8\u30C7\u30A3\u30BF\u3092\u65B0\u3057\u3044\u30BF\u30D6\u3067\u958B\u304D\u307E\u3057\u305F\u3002");
      return;
    }
    try {
      const resp = await fetch(`${serverUrl}/api/bridge/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault: this.app.vault.getName(),
          note,
          name: file.name
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.delivered) {
        new import_obsidian.Notice("\u65E2\u5B58\u306E\u5F71\u5370\u6821\u30A8\u30C7\u30A3\u30BF\u306B\u30CE\u30FC\u30C8\u3092\u5207\u308A\u66FF\u3048\u307E\u3057\u305F\u3002");
      } else {
        window.open(newTabUrl, "_blank");
        new import_obsidian.Notice("\u5F71\u5370\u6821\u30A8\u30C7\u30A3\u30BF\u3092\u65B0\u3057\u304F\u958B\u304D\u307E\u3057\u305F\u3002");
      }
    } catch (_e) {
      window.open(newTabUrl, "_blank");
      new import_obsidian.Notice("\u65E2\u5B58\u30BF\u30D6\u3078\u306E\u901A\u77E5\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u3001\u65B0\u3057\u3044\u30BF\u30D6\u3092\u958B\u304D\u307E\u3057\u305F\u3002");
    }
  }
  // ── File open pipeline ────────────────────────────────────────────────────
  //
  // 1. Validates the extension.
  // 2. Resolves TFile → OcrDocumentSet using the configured strategy.
  // 3. Notifies the user about required missing slots (per settings.resolver.required).
  // 4. Opens the web proofreading app via openInWebApp() based on launchMode.
  async openFileInProofer(file) {
    if (!SUPPORTED_EXTENSIONS.has(file.extension)) {
      new import_obsidian.Notice(
        `OCR Proofer: .${file.extension} \u30D5\u30A1\u30A4\u30EB\u306F\u73FE\u5728\u672A\u5BFE\u5FDC\u3067\u3059 \uFF08\u5BFE\u5FDC\u5F62\u5F0F: ${[...SUPPORTED_EXTENSIONS].join(", ")}\uFF09\u3002`
      );
      return;
    }
    const docSet = await this.resolver.resolve(this.app, file);
    const req = this.settings.resolver.required;
    const requiredMissing = docSet.missing.filter((m) => {
      if (m === "image") return req.image;
      if (m === "ocr-data") return req.ocrData;
      if (m === "ocr-text") return req.ocrData;
      if (m === "correction-log") return req.correctionLog;
      return true;
    });
    const notResolved = docSet.resolutionMethod === "none" || docSet.pages.length === 0;
    if (notResolved) {
      new import_obsidian.Notice("OCR Proofer: \u95A2\u9023\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\uFF08\u753B\u50CF\u30FBOCR \u30C7\u30FC\u30BF\uFF09\u3002");
    } else if (requiredMissing.length > 0) {
      const labels = {
        "image": "\u753B\u50CF\u30D5\u30A1\u30A4\u30EB",
        "ocr-data": "OCR \u30C7\u30FC\u30BF (JSON)",
        "ocr-text": "OCR \u30C6\u30AD\u30B9\u30C8 (callout)",
        "correction-log": "\u6821\u6B63\u30ED\u30B0"
      };
      const listed = requiredMissing.map((m) => {
        var _a;
        return (_a = labels[m]) != null ? _a : m;
      }).join("\u3001");
      new import_obsidian.Notice(`OCR Proofer: \u5FC5\u9808\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093 \u2014 ${listed}`);
    }
    await this.openInWebApp(file);
  }
};
var VALID_STEPS = ["body-callout", "frontmatter", "basename", "folder-scan"];
var OcrProoferSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "OCR Proofer \u8A2D\u5B9A" });
    containerEl.createEl("h3", { text: "\u8D77\u52D5\u8A2D\u5B9A" });
    new import_obsidian.Setting(containerEl).setName("\u30B5\u30FC\u30D0\u30FC URL").setDesc("\u5F71\u5370\u6821\u30A2\u30D7\u30EA\u306E\u30D9\u30FC\u30B9 URL\uFF08\u65E2\u5B9A: http://localhost:8000\uFF09").addText(
      (text) => text.setPlaceholder("http://localhost:8000").setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value.trim() || DEFAULT_SETTINGS.serverUrl;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u8D77\u52D5\u30E2\u30FC\u30C9").setDesc("\u901A\u5E38\u306E\u6821\u6B63\u4F5C\u696D\u3067\u306F\u300C\u65E2\u5B58\u30BF\u30D6\u3092\u518D\u5229\u7528\u300D\u3092\u63A8\u5968\u3057\u307E\u3059\u3002").addDropdown(
      (dropdown) => dropdown.addOption("reuse-existing", "\u65E2\u5B58\u30BF\u30D6\u3092\u518D\u5229\u7528").addOption("always-new", "\u5E38\u306B\u65B0\u3057\u3044\u30BF\u30D6\u3092\u958B\u304F").setValue(this.plugin.settings.launchMode).onChange(async (value) => {
        this.plugin.settings.launchMode = value;
        await this.plugin.saveSettings();
      })
    );
    const modeDesc = containerEl.createEl("div", { cls: "setting-item-description" });
    modeDesc.style.padding = "0 12px 12px";
    const ul = modeDesc.createEl("ul");
    ul.style.margin = "4px 0 0 16px";
    const li1 = ul.createEl("li");
    li1.createEl("strong", { text: "\u65E2\u5B58\u30BF\u30D6\u3092\u518D\u5229\u7528" });
    li1.appendText("\uFF1A\u3059\u3067\u306B\u958B\u3044\u3066\u3044\u308B\u5F71\u5370\u6821\u30A8\u30C7\u30A3\u30BF\u304C\u3042\u308C\u3070\u3001\u305D\u306E\u30BF\u30D6\u3067\u5225\u30CE\u30FC\u30C8\u306B\u5207\u308A\u66FF\u3048\u307E\u3059\u3002\u958B\u3044\u3066\u3044\u306A\u3044\u5834\u5408\u306E\u307F\u65B0\u3057\u3044\u30BF\u30D6\u3092\u958B\u304D\u307E\u3059\u3002");
    const li2 = ul.createEl("li");
    li2.createEl("strong", { text: "\u5E38\u306B\u65B0\u3057\u3044\u30BF\u30D6\u3092\u958B\u304F" });
    li2.appendText("\uFF1A\u30CE\u30FC\u30C8\u3054\u3068\u306B\u5225\u30BF\u30D6\u3067\u958B\u304D\u307E\u3059\u3002\u8907\u6570\u30CE\u30FC\u30C8\u3092\u4E26\u884C\u3057\u3066\u78BA\u8A8D\u3057\u305F\u3044\u5834\u5408\u306B\u4F7F\u3044\u307E\u3059\u3002");
    containerEl.createEl("h3", { text: "RESOLVER" });
    new import_obsidian.Setting(containerEl).setName("Image frontmatter key").setDesc("\u753B\u50CF\u30D5\u30A1\u30A4\u30EB\u3078\u306E\u30D1\u30B9\u3092\u6301\u3064 frontmatter \u30AD\u30FC\u540D\uFF08\u65E2\u5B9A: ocr_image\uFF09").addText(
      (text) => text.setPlaceholder("ocr_image").setValue(this.plugin.settings.resolver.frontmatterKeys.image).onChange(async (value) => {
        this.plugin.settings.resolver.frontmatterKeys.image = value.trim() || DEFAULT_RESOLVER_SETTINGS.frontmatterKeys.image;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("OCR data frontmatter key").setDesc("OCR \u30C7\u30FC\u30BF\u30D5\u30A1\u30A4\u30EB\u3078\u306E\u30D1\u30B9\u3092\u6301\u3064 frontmatter \u30AD\u30FC\u540D\uFF08\u65E2\u5B9A: ocr_data\uFF09").addText(
      (text) => text.setPlaceholder("ocr_data").setValue(this.plugin.settings.resolver.frontmatterKeys.ocrData).onChange(async (value) => {
        this.plugin.settings.resolver.frontmatterKeys.ocrData = value.trim() || DEFAULT_RESOLVER_SETTINGS.frontmatterKeys.ocrData;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Correction log frontmatter key").setDesc("\u6821\u6B63\u30ED\u30B0\u30D5\u30A1\u30A4\u30EB\u3078\u306E\u30D1\u30B9\u3092\u6301\u3064 frontmatter \u30AD\u30FC\u540D\uFF08\u65E2\u5B9A: correction_log\uFF09").addText(
      (text) => text.setPlaceholder("correction_log").setValue(this.plugin.settings.resolver.frontmatterKeys.correctionLog).onChange(async (value) => {
        this.plugin.settings.resolver.frontmatterKeys.correctionLog = value.trim() || DEFAULT_RESOLVER_SETTINGS.frontmatterKeys.correctionLog;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Resolution priority").setDesc(
      "\u89E3\u6C7A\u30B9\u30C6\u30C3\u30D7\u306E\u512A\u5148\u9806\u4F4D\u3092\u30AB\u30F3\u30DE\u533A\u5207\u308A\u3067\u6307\u5B9A\u3057\u307E\u3059\u3002\u6709\u52B9\u5024: body-callout, frontmatter, basename, folder-scan\u3002\u65E2\u5B9A: body-callout, frontmatter, basename, folder-scan"
    ).addText(
      (text) => text.setPlaceholder("frontmatter, basename, folder-scan").setValue(this.plugin.settings.resolver.resolutionPriority.join(", ")).onChange(async (value) => {
        const parsed = value.split(",").map((s) => s.trim()).filter((s) => VALID_STEPS.includes(s));
        this.plugin.settings.resolver.resolutionPriority = parsed.length > 0 ? parsed : DEFAULT_RESOLVER_SETTINGS.resolutionPriority;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h4", { text: "Required files (missing \u2192 Notice)" });
    new import_obsidian.Setting(containerEl).setName("Image required").setDesc("\u753B\u50CF\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u3089\u306A\u3044\u5834\u5408\u306B\u8B66\u544A\u3092\u8868\u793A\u3059\u308B\uFF08\u65E2\u5B9A: \u30AA\u30F3\uFF09").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.resolver.required.image).onChange(async (value) => {
        this.plugin.settings.resolver.required.image = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("OCR data required").setDesc("OCR \u30C7\u30FC\u30BF\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u3089\u306A\u3044\u5834\u5408\u306B\u8B66\u544A\u3092\u8868\u793A\u3059\u308B\uFF08\u65E2\u5B9A: \u30AA\u30F3\uFF09").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.resolver.required.ocrData).onChange(async (value) => {
        this.plugin.settings.resolver.required.ocrData = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Correction log required").setDesc("\u6821\u6B63\u30ED\u30B0\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u3089\u306A\u3044\u5834\u5408\u306B\u8B66\u544A\u3092\u8868\u793A\u3059\u308B\uFF08\u65E2\u5B9A: \u30AA\u30D5\uFF09").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.resolver.required.correctionLog).onChange(async (value) => {
        this.plugin.settings.resolver.required.correctionLog = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
function showConfirmModal(app, fileName) {
  return new Promise((resolve) => {
    new ConfirmModal(app, fileName, resolve).open();
  });
}
var ConfirmModal = class extends import_obsidian.Modal {
  constructor(app, fileName, onResolve) {
    super(app);
    this.resolved = false;
    this.fileName = fileName;
    this.onResolve = onResolve;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "\u30CE\u30FC\u30C8\u306E\u518D\u8AAD\u307F\u8FBC\u307F\u78BA\u8A8D" });
    contentEl.createEl("p", {
      text: `\u300C${this.fileName}\u300D\u306F\u3059\u3067\u306B\u30D6\u30E9\u30A6\u30B6\u30BF\u30D6\u3067\u958B\u304B\u308C\u3066\u3044\u307E\u3059\u3002`
    });
    contentEl.createEl("p", {
      text: "\u672A\u4FDD\u5B58\u306E\u5909\u66F4\u304C\u3042\u308B\u5834\u5408\u306F\u5931\u308F\u308C\u307E\u3059\u3002\u30BF\u30D6\u3092\u66F4\u65B0\u3057\u307E\u3059\u304B\uFF1F"
    });
    new import_obsidian.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("\u66F4\u65B0\u3059\u308B").setCta().onClick(() => {
        this.resolved = true;
        this.onResolve(true);
        this.close();
      })
    ).addButton(
      (btn) => btn.setButtonText("\u30AD\u30E3\u30F3\u30BB\u30EB").onClick(() => {
        this.resolved = true;
        this.onResolve(false);
        this.close();
      })
    );
  }
  onClose() {
    if (!this.resolved) this.onResolve(false);
    this.contentEl.empty();
  }
};
