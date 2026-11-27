export interface PoolHolder<Pool> {
  pool?: Pool;
}

export function getOrCreatePool<Pool>(
  holder: PoolHolder<Pool>,
  create: () => Pool,
): Pool {
  if (holder.pool) return holder.pool;
  const pool = create();
  holder.pool = pool;
  return pool;
}

export async function closePool<Pool extends { end(): Promise<void> }>(
  holder: PoolHolder<Pool>,
): Promise<void> {
  const pool = holder.pool;
  if (!pool) return;
  holder.pool = undefined;
  await pool.end();
}
