import { parseDineInOrderPage } from "./dine-in-orders-list";
import type { DineInOrderSummary } from "./dine-in-orders-list";

/**
 * Read-only archive of past orders. It searches the same normalized order
 * history the board reads, but answers to a name, table, reference, or date
 * range instead of to the live status of the kitchen.
 */

const PAGE_SIZE = 25;

/** A record kept from the previous ordering system. It has no table and no amount. */
export interface HistoricalOrderRecord {
  id: string;
  createdAt: number;
  name: string;
  notes?: string;
  lines: { name: string; options: string[]; quantity: number }[];
}

export interface HistoricalArchiveFilter {
  query: string;
  fromDate: string;
  toDate: string;
}

export interface HistoricalArchiveState extends HistoricalArchiveFilter {
  orders: DineInOrderSummary[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  loadMoreError: boolean;
}

export function isHistoricalArchiveFilterEmpty(filter: HistoricalArchiveFilter): boolean {
  return filter.query.trim() === "" && filter.fromDate === "" && filter.toDate === "";
}

function requestQuery(filter: HistoricalArchiveFilter, cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  const term = filter.query.trim();
  if (term) query.set("q", term);
  if (filter.fromDate) query.set("from", filter.fromDate);
  if (filter.toDate) query.set("to", filter.toDate);
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}

export function createHistoricalOrdersArchiveController(fetcher: typeof fetch = fetch) {
  let state: HistoricalArchiveState = {
    query: "",
    fromDate: "",
    toDate: "",
    orders: [],
    nextCursor: null,
    loading: false,
    loadingMore: false,
    error: false,
    loadMoreError: false,
  };
  let generation = 0;
  let started = false;
  let loadMoreInFlight = false;
  const listeners = new Set<(next: HistoricalArchiveState) => void>();

  function update(next: HistoricalArchiveState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  async function loadFirstPage(requestGeneration: number, filter: HistoricalArchiveFilter) {
    update({ ...state, ...filter, loading: true, error: false, loadMoreError: false });
    try {
      const response = await fetcher(`/api/admin/dine-in/orders?${requestQuery(filter, null)}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Past orders could not be loaded.");
      const page = parseDineInOrderPage(await response.json(), PAGE_SIZE);
      if (requestGeneration !== generation) return;
      update({
        ...state,
        orders: page.orders,
        nextCursor: page.pagination.nextCursor,
        loading: false,
        error: false,
        loadMoreError: false,
      });
    } catch {
      if (requestGeneration !== generation) return;
      update({ ...state, orders: [], nextCursor: null, loading: false, error: true });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: (next: HistoricalArchiveState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (started) return Promise.resolve();
      started = true;
      generation += 1;
      return loadFirstPage(generation, { query: state.query, fromDate: state.fromDate, toDate: state.toDate });
    },
    setFilter(filter: HistoricalArchiveFilter) {
      generation += 1;
      const requestGeneration = generation;
      return loadFirstPage(requestGeneration, filter);
    },
    async loadMore() {
      const cursor = state.nextCursor;
      if (!cursor || state.loading || state.loadingMore || loadMoreInFlight) return;
      loadMoreInFlight = true;
      const requestGeneration = generation;
      const filter: HistoricalArchiveFilter = {
        query: state.query,
        fromDate: state.fromDate,
        toDate: state.toDate,
      };
      update({ ...state, loadingMore: true, loadMoreError: false });
      try {
        const response = await fetcher(`/api/admin/dine-in/orders?${requestQuery(filter, cursor)}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Past orders could not be loaded.");
        const page = parseDineInOrderPage(await response.json(), PAGE_SIZE);
        if (requestGeneration !== generation || state.nextCursor !== cursor) return;
        const seenIds = new Set(state.orders.map((order) => order.orderId));
        update({
          ...state,
          orders: [...state.orders, ...page.orders.filter((order) => !seenIds.has(order.orderId))],
          nextCursor: page.pagination.nextCursor,
          loadingMore: false,
          loadMoreError: false,
        });
      } catch {
        if (requestGeneration === generation) update({ ...state, loadingMore: false, loadMoreError: true });
      } finally {
        loadMoreInFlight = false;
        if (state.loadingMore) update({ ...state, loadingMore: false });
      }
    },
  };
}
