// Document reference resolver — entry point adapter for the open pipeline.
//
// Accepts any of the shapes that can arrive from different entry points:
//   string          → plain docId (current web UI, command input)
//   { type, value } → typed reference: type = 'id' | 'path'
//   { path }        → TFile-like object (future Obsidian TFile / file-menu context)
//
// Future Obsidian adapters should transform their native types here before
// passing to openDocument(), keeping the pipeline entry-point agnostic.
//
// Examples of future entry points (not yet wired):
//   file-menu:  resolveDocumentRef(tFile)              → tFile.path
//   command:    resolveDocumentRef({ type:'id', value: activeDocId })
//   registerView: resolveDocumentRef({ path: viewState.file })

export function resolveDocumentRef(ref) {
  if (typeof ref === 'string') return ref;
  if (ref?.type === 'id' || ref?.type === 'path') return ref.value ?? null;
  if (typeof ref?.path === 'string') return ref.path;
  return null;
}
