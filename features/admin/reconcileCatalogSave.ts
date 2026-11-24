import type { Catalog } from "../../lib/types";

/** Keep edits made after a save began while adopting the server revision. */
export function reconcileCatalogSave(
  currentDraft: Catalog,
  submittedDraft: Catalog,
  savedCatalog: Catalog,
): Catalog {
  if (JSON.stringify(currentDraft) === JSON.stringify(submittedDraft))
    return savedCatalog;

  return { ...currentDraft, revision: savedCatalog.revision };
}
