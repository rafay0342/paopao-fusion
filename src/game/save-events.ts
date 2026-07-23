type LocalSaveListener = () => void;

const listeners = new Set<LocalSaveListener>();

/**
 * Legacy V3 stores remain the live Phaser gameplay stores during the V4
 * migration. They publish one process-local signal after durable mutations so
 * the V4 envelope can mirror them without creating import cycles.
 */
export function notifyLocalSaveChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeLocalSaveChanges(listener: LocalSaveListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
