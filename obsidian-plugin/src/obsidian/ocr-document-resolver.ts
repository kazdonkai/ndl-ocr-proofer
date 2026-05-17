import { App, TFile } from 'obsidian';

import type { OcrDocumentSet } from '../core/types';
import { DefaultResolutionStrategy } from '../core/resolution-strategy';
import type { ResolutionStrategy } from '../core/resolution-strategy';
import { ObsidianVaultAdapter } from './obsidian-vault-adapter';

export class OcrDocumentResolver {
  private strategy: ResolutionStrategy;

  constructor(strategy: ResolutionStrategy = new DefaultResolutionStrategy()) {
    this.strategy = strategy;
  }

  resolve(app: App, file: TFile): Promise<OcrDocumentSet> {
    return this.strategy.resolve(new ObsidianVaultAdapter(app), file);
  }
}

/** Convenience wrapper — uses a fresh OcrDocumentResolver unless one is supplied. */
export function resolveOcrDocumentFromTFile(
  app: App,
  file: TFile,
  resolver?: OcrDocumentResolver,
): Promise<OcrDocumentSet> {
  return (resolver ?? new OcrDocumentResolver()).resolve(app, file);
}
