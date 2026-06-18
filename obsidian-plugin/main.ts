import { App, Editor, ItemView, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import {
  DEFAULT_RESOLVER_SETTINGS,
  DefaultResolutionStrategy,
  OcrDocumentResolver,
  OcrDocumentSet,
  ResolverSettings,
  ResolutionStep,
} from './resolver';

export const OCR_PROOFER_VIEW_TYPE = 'ocr-proofer-view';

// File extensions the current proofreading app can handle.
const SUPPORTED_EXTENSIONS = new Set(['md', 'txt', 'json']);

// ── Plugin settings ───────────────────────────────────────────────────────────
//
// Top-level wrapper ready for additional sections (e.g. display, keybindings).
// Stored via Plugin.loadData() / Plugin.saveData() for Obsidian persistence.

export type LaunchMode = 'reuse-existing' | 'always-new';

export interface OcrProoferSettings {
  resolver: ResolverSettings;
  /** Base URL of the running proofreading app (default: http://localhost:8000). */
  serverUrl: string;
  /**
   * How to open the proofreading editor when a file is sent from Obsidian.
   *  reuse-existing  – POST to /api/bridge/open; open new tab only if no tab is listening.
   *  always-new      – always open a new browser tab (SSE bridge not used).
   */
  launchMode: LaunchMode;
}

const DEFAULT_SETTINGS: OcrProoferSettings = {
  resolver: DEFAULT_RESOLVER_SETTINGS,
  serverUrl: 'http://localhost:8000',
  launchMode: 'reuse-existing',
};

// ── Document open abstraction ─────────────────────────────────────────────────
//
// All three entry points (file-menu, editor-menu, command palette) funnel
// through openFileInProofer() → resolver.resolve() → openInWebApp().
//
// The Obsidian-side OcrProoferView remains as a placeholder panel; the primary
// UI is the React web frontend opened in a browser tab via openInWebApp().

export interface DocumentOpenService {
  openDocumentByPath(path: string): void;
  /** Richer variant — receives the full resolved OCR set. Optional for backward compat. */
  openDocumentSet?(set: OcrDocumentSet): void;
}

class PlaceholderDocumentOpenService implements DocumentOpenService {
  openDocumentByPath(_path: string): void {
    // no-op until React UI is mounted inside the Obsidian panel
  }

  openDocumentSet(_set: OcrDocumentSet): void {
    // no-op until React UI is mounted inside the Obsidian panel
  }
}

// ── Custom View ───────────────────────────────────────────────────────────────

export class OcrProoferView extends ItemView {
  private openService: DocumentOpenService;

  constructor(leaf: WorkspaceLeaf, openService: DocumentOpenService) {
    super(leaf);
    this.openService = openService;
  }

  getViewType(): string {
    return OCR_PROOFER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'OCR Proofer';
  }

  getIcon(): string {
    return 'scan-text';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('ocr-proofer-view');

    const placeholder = container.createDiv({ cls: 'ocr-proofer-placeholder' });
    placeholder.createEl('p', { text: 'OCR Proofer' });
    placeholder.createEl('p', {
      cls: 'ocr-proofer-placeholder__sub',
      text: 'React UI をここにマウントします（将来実装）',
    });
  }

  async onClose(): Promise<void> {
    // Future: this._reactRoot?.unmount();
  }

  // Called by the plugin open pipeline after OCR set resolution.
  openDocument(docSet: OcrDocumentSet): void {
    this.openService.openDocumentByPath(docSet.sourceFile.path);
    this.openService.openDocumentSet?.(docSet);
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class OcrProoferPlugin extends Plugin {
  settings: OcrProoferSettings = { ...DEFAULT_SETTINGS };
  private openService: DocumentOpenService = new PlaceholderDocumentOpenService();
  private resolver = new OcrDocumentResolver();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      OCR_PROOFER_VIEW_TYPE,
      (leaf) => new OcrProoferView(leaf, this.openService),
    );

    // ── Ribbon ──────────────────────────────────────────────────────────────
    this.addRibbonIcon('scan-text', 'Open OCR Proofer', () => {
      this.activateView();
    });

    // ── Commands ─────────────────────────────────────────────────────────────

    this.addCommand({
      id: 'open-ocr-proofer',
      name: 'Open OCR Proofer',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'open-active-file-in-ocr-proofer',
      name: 'Open active file in OCR Proofer',
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice('OCR Proofer: アクティブなファイルがありません。');
          return;
        }
        this.openFileInProofer(file);
      },
    });

    // ── File Explorer context menu ────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, abstractFile) => {
        if (!(abstractFile instanceof TFile)) return;
        if (!SUPPORTED_EXTENSIONS.has(abstractFile.extension)) return;
        const file = abstractFile;
        menu.addItem((item) => {
          item
            .setTitle('Open in OCR Proofer')
            .setIcon('scan-text')
            .onClick(() => this.openFileInProofer(file));
        });
      }),
    );

    // ── Editor context menu ───────────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, _editor, info) => {
        const file = info instanceof MarkdownView ? info.file : info.file;
        if (!file) return;
        if (!SUPPORTED_EXTENSIONS.has(file.extension)) return;
        menu.addItem((item) => {
          item
            .setTitle('Open current file in OCR Proofer')
            .setIcon('scan-text')
            .onClick(() => this.openFileInProofer(file!));
        });
      }),
    );

    // ── Settings tab ──────────────────────────────────────────────────────
    this.addSettingTab(new OcrProoferSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    // Obsidian detaches leaves automatically on plugin unload.
  }

  // ── Settings management ───────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) ?? {};
    const savedResolver = saved.resolver ?? {};
    this.settings = {
      resolver: {
        frontmatterKeys: {
          ...DEFAULT_RESOLVER_SETTINGS.frontmatterKeys,
          ...(savedResolver.frontmatterKeys ?? {}),
        },
        resolutionPriority:
          savedResolver.resolutionPriority ?? DEFAULT_RESOLVER_SETTINGS.resolutionPriority,
        required: {
          ...DEFAULT_RESOLVER_SETTINGS.required,
          ...(savedResolver.required ?? {}),
        },
      },
      serverUrl: (typeof saved.serverUrl === 'string' && saved.serverUrl)
        ? saved.serverUrl
        : DEFAULT_SETTINGS.serverUrl,
      launchMode: (saved.launchMode === 'reuse-existing' || saved.launchMode === 'always-new')
        ? saved.launchMode
        : DEFAULT_SETTINGS.launchMode,
    };
    this.rebuildResolver();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rebuildResolver();
  }

  private rebuildResolver(): void {
    this.resolver = new OcrDocumentResolver(
      new DefaultResolutionStrategy(this.settings.resolver),
    );
  }

  // ── Leaf activation ───────────────────────────────────────────────────────

  async activateView(): Promise<OcrProoferView | null> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(OCR_PROOFER_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return existing[0].view as OcrProoferView;
    }

    const leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
    await leaf.setViewState({ type: OCR_PROOFER_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
    return leaf.view as OcrProoferView;
  }

  // ── Web app opening ───────────────────────────────────────────────────────
  //
  // Dispatches to the running proofreading web app based on launchMode:
  //   reuse-existing  – use SSE bridge; fall back to new tab when no client is listening.
  //   always-new      – always open a new browser tab.
  private async openInWebApp(file: TFile): Promise<void> {
    const note = file.path;
    const serverUrl = this.settings.serverUrl.replace(/\/$/, '');
    const newTabUrl = `${serverUrl}/?note=${encodeURIComponent(note)}`;

    if (this.settings.launchMode === 'always-new') {
      window.open(newTabUrl, '_blank');
      new Notice('影印校エディタを新しいタブで開きました。');
      return;
    }

    // reuse-existing: try SSE bridge first.
    try {
      const resp = await fetch(`${serverUrl}/api/bridge/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vault: this.app.vault.getName(),
          note,
          name: file.name,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: { delivered: boolean } = await resp.json();
      if (data.delivered) {
        new Notice('既存の影印校エディタにノートを切り替えました。');
      } else {
        window.open(newTabUrl, '_blank');
        new Notice('影印校エディタを新しく開きました。');
      }
    } catch (_e) {
      window.open(newTabUrl, '_blank');
      new Notice('既存タブへの通知に失敗したため、新しいタブを開きました。');
    }
  }

  // ── File open pipeline ────────────────────────────────────────────────────
  //
  // 1. Validates the extension.
  // 2. Resolves TFile → OcrDocumentSet using the configured strategy.
  // 3. Notifies the user about required missing slots (per settings.resolver.required).
  // 4. Opens the web proofreading app via openInWebApp() based on launchMode.
  private async openFileInProofer(file: TFile): Promise<void> {
    if (!SUPPORTED_EXTENSIONS.has(file.extension)) {
      new Notice(
        `OCR Proofer: .${file.extension} ファイルは現在未対応です` +
          ` （対応形式: ${[...SUPPORTED_EXTENSIONS].join(', ')}）。`,
      );
      return;
    }

    const docSet = await this.resolver.resolve(this.app, file);

    // Determine which missing slots are required per settings.
    const req = this.settings.resolver.required;
    const requiredMissing = docSet.missing.filter((m) => {
      if (m === 'image')          return req.image;
      if (m === 'ocr-data')       return req.ocrData;
      if (m === 'ocr-text')       return req.ocrData;  // callout text treated same as ocr-data
      if (m === 'correction-log') return req.correctionLog;
      return true;
    });

    const notResolved = docSet.resolutionMethod === 'none' || docSet.pages.length === 0;
    if (notResolved) {
      new Notice('OCR Proofer: 関連ファイルが見つかりませんでした（画像・OCR データ）。');
    } else if (requiredMissing.length > 0) {
      const labels: Record<string, string> = {
        'image':           '画像ファイル',
        'ocr-data':        'OCR データ (JSON)',
        'ocr-text':        'OCR テキスト (callout)',
        'correction-log':  '校正ログ',
      };
      const listed = requiredMissing.map((m) => labels[m] ?? m).join('、');
      new Notice(`OCR Proofer: 必須ファイルが見つかりません — ${listed}`);
    }

    await this.openInWebApp(file);
  }
}

// ── Settings tab ──────────────────────────────────────────────────────────────

const VALID_STEPS: ResolutionStep[] = ['body-callout', 'frontmatter', 'basename', 'folder-scan'];

class OcrProoferSettingTab extends PluginSettingTab {
  plugin: OcrProoferPlugin;

  constructor(app: App, plugin: OcrProoferPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'OCR Proofer 設定' });

    // ── 起動設定 ──────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: '起動設定' });

    new Setting(containerEl)
      .setName('サーバー URL')
      .setDesc('影印校アプリのベース URL（既定: http://localhost:8000）')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:8000')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim() || DEFAULT_SETTINGS.serverUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('起動モード')
      .setDesc('通常の校正作業では「既存タブを再利用」を推奨します。')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('reuse-existing', '既存タブを再利用')
          .addOption('always-new', '常に新しいタブを開く')
          .setValue(this.plugin.settings.launchMode)
          .onChange(async (value) => {
            this.plugin.settings.launchMode = value as LaunchMode;
            await this.plugin.saveSettings();
          }),
      );

    const modeDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
    modeDesc.style.padding = '0 12px 12px';
    const ul = modeDesc.createEl('ul');
    ul.style.margin = '4px 0 0 16px';
    const li1 = ul.createEl('li');
    li1.createEl('strong', { text: '既存タブを再利用' });
    li1.appendText('：すでに開いている影印校エディタがあれば、そのタブで別ノートに切り替えます。開いていない場合のみ新しいタブを開きます。');
    const li2 = ul.createEl('li');
    li2.createEl('strong', { text: '常に新しいタブを開く' });
    li2.appendText('：ノートごとに別タブで開きます。複数ノートを並行して確認したい場合に使います。');

    // ── RESOLVER section ──────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'RESOLVER' });

    new Setting(containerEl)
      .setName('Image frontmatter key')
      .setDesc('画像ファイルへのパスを持つ frontmatter キー名（既定: ocr_image）')
      .addText((text) =>
        text
          .setPlaceholder('ocr_image')
          .setValue(this.plugin.settings.resolver.frontmatterKeys.image)
          .onChange(async (value) => {
            this.plugin.settings.resolver.frontmatterKeys.image =
              value.trim() || DEFAULT_RESOLVER_SETTINGS.frontmatterKeys.image;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('OCR data frontmatter key')
      .setDesc('OCR データファイルへのパスを持つ frontmatter キー名（既定: ocr_data）')
      .addText((text) =>
        text
          .setPlaceholder('ocr_data')
          .setValue(this.plugin.settings.resolver.frontmatterKeys.ocrData)
          .onChange(async (value) => {
            this.plugin.settings.resolver.frontmatterKeys.ocrData =
              value.trim() || DEFAULT_RESOLVER_SETTINGS.frontmatterKeys.ocrData;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Correction log frontmatter key')
      .setDesc('校正ログファイルへのパスを持つ frontmatter キー名（既定: correction_log）')
      .addText((text) =>
        text
          .setPlaceholder('correction_log')
          .setValue(this.plugin.settings.resolver.frontmatterKeys.correctionLog)
          .onChange(async (value) => {
            this.plugin.settings.resolver.frontmatterKeys.correctionLog =
              value.trim() || DEFAULT_RESOLVER_SETTINGS.frontmatterKeys.correctionLog;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Resolution priority')
      .setDesc(
        '解決ステップの優先順位をカンマ区切りで指定します。' +
          '有効値: body-callout, frontmatter, basename, folder-scan。' +
          '既定: body-callout, frontmatter, basename, folder-scan',
      )
      .addText((text) =>
        text
          .setPlaceholder('frontmatter, basename, folder-scan')
          .setValue(this.plugin.settings.resolver.resolutionPriority.join(', '))
          .onChange(async (value) => {
            const parsed = value
              .split(',')
              .map((s) => s.trim() as ResolutionStep)
              .filter((s) => VALID_STEPS.includes(s));
            this.plugin.settings.resolver.resolutionPriority =
              parsed.length > 0 ? parsed : DEFAULT_RESOLVER_SETTINGS.resolutionPriority;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h4', { text: 'Required files (missing → Notice)' });

    new Setting(containerEl)
      .setName('Image required')
      .setDesc('画像ファイルが見つからない場合に警告を表示する（既定: オン）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.resolver.required.image)
          .onChange(async (value) => {
            this.plugin.settings.resolver.required.image = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('OCR data required')
      .setDesc('OCR データファイルが見つからない場合に警告を表示する（既定: オン）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.resolver.required.ocrData)
          .onChange(async (value) => {
            this.plugin.settings.resolver.required.ocrData = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Correction log required')
      .setDesc('校正ログファイルが見つからない場合に警告を表示する（既定: オフ）')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.resolver.required.correctionLog)
          .onChange(async (value) => {
            this.plugin.settings.resolver.required.correctionLog = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
