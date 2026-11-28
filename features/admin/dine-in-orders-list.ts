import { formatMinorUnits } from "../../lib/money";
import type { Language } from "../../lib/types";

export const DINE_IN_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type DineInOrderStatus = (typeof DINE_IN_ORDER_STATUSES)[number];
export type DineInOrdersView = "in_progress" | "finished" | "all";
/** Which calendar days the board covers. "today" uses the restaurant's timezone. */
export type DineInOrdersScope = "all" | "today";

export interface DineInOrderSummary {
  orderId: string;
  createdAt: string;
  status: DineInOrderStatus;
  customerName: string | null;
  tableLabel: string;
  totalMillimes: number;
  revision: number;
  customerNotes: string | null;
  items: { productName: string; quantity: number; lineTotalMillimes: number; options: string[] }[];
}

export interface DineInOrderPage {
  orders: DineInOrderSummary[];
  pagination: { limit: number; nextCursor: string | null };
}

export interface DineInOrdersState {
  view: DineInOrdersView;
  scope: DineInOrdersScope;
  orders: DineInOrderSummary[];
  nextCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  backgroundRefreshing: boolean;
  backgroundRefreshFailed: boolean;
  error: boolean;
  loadMoreError: boolean;
  newOrderIds: string[];
  lastCheckedAt: number | null;
}

export interface DineInOrderPollingEnvironment {
  startInterval(callback: () => void, milliseconds: number): () => void;
  subscribeVisibility(callback: () => void): () => void;
  isVisible(): boolean;
}

export function startDineInOrdersAutoRefresh(
  refresh: () => Promise<unknown>,
  environment: DineInOrderPollingEnvironment,
): () => void {
  let stopped = false;
  let inFlight = false;
  let refreshWhenAvailable = false;
  const run = async (queueWhenBusy = false) => {
    if (stopped || !environment.isVisible()) return;
    if (inFlight) {
      if (queueWhenBusy) refreshWhenAvailable = true;
      return;
    }
    inFlight = true;
    try {
      await refresh();
    } catch {
      // The controller owns user-visible background error state.
    } finally {
      inFlight = false;
      const shouldRefresh = refreshWhenAvailable;
      refreshWhenAvailable = false;
      if (shouldRefresh && !stopped && environment.isVisible()) {
        void run();
      }
    }
  };
  const stopInterval = environment.startInterval(() => { void run(); }, 30_000);
  const stopVisibility = environment.subscribeVisibility(() => { void run(true); });
  return () => {
    if (stopped) return;
    stopped = true;
    refreshWhenAvailable = false;
    stopInterval();
    stopVisibility();
  };
}

const PAGE_SIZE = 25;
const MAX_CURSOR_LENGTH = 1_024;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const MAX_DATE_MILLISECONDS = BigInt("8640000000000000");

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStatus(value: unknown): value is DineInOrderStatus {
  return typeof value === "string" &&
    (DINE_IN_ORDER_STATUSES as readonly string[]).includes(value);
}

function matchesView(view: DineInOrdersView, status: DineInOrderStatus): boolean {
  if (view === "all") return true;
  if (view === "in_progress") return status === "pending" || status === "confirmed" || status === "preparing";
  return status === "completed" || status === "rejected" || status === "cancelled";
}

export function parseDineInCreatedAt(value: string): Date | null {
  if (value.length > 16 || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const milliseconds = BigInt(value);
  if (milliseconds > MAX_DATE_MILLISECONDS) return null;
  const date = new Date(Number(milliseconds));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDineInTotal(amount: number, language: Language): string {
  return `${formatMinorUnits(amount, language)} TND`;
}

export function parseDineInOrderPage(value: unknown, expectedLimit: number): DineInOrderPage {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "orders,pagination" ||
    !Array.isArray(value.orders) || value.orders.length > expectedLimit || !isRecord(value.pagination) ||
    Object.keys(value.pagination).sort().join(",") !== "limit,nextCursor" ||
    value.pagination.limit !== expectedLimit ||
    !(value.pagination.nextCursor === null ||
      (typeof value.pagination.nextCursor === "string" &&
        value.pagination.nextCursor.length > 0 &&
        value.pagination.nextCursor.length <= MAX_CURSOR_LENGTH))
  ) throw new Error("Invalid dine-in order response.");

  const orders = value.orders.map((candidate): DineInOrderSummary => {
    if (!isRecord(candidate) ||
      Object.keys(candidate).sort().join(",") !==
        "createdAt,customerName,customerNotes,items,orderId,revision,status,tableLabel,totalMillimes" ||
      typeof candidate.orderId !== "string" || !UUID_PATTERN.test(candidate.orderId) ||
      typeof candidate.createdAt !== "string" || !parseDineInCreatedAt(candidate.createdAt) ||
      !isStatus(candidate.status) ||
      !(candidate.customerName === null || typeof candidate.customerName === "string") ||
      typeof candidate.tableLabel !== "string" || !candidate.tableLabel.trim() ||
      !(candidate.customerNotes === null || typeof candidate.customerNotes === "string") ||
      typeof candidate.totalMillimes !== "number" ||
      !Number.isSafeInteger(candidate.totalMillimes) || candidate.totalMillimes < 0 ||
      typeof candidate.revision !== "number" || !Number.isSafeInteger(candidate.revision) || candidate.revision < 0 ||
      !Array.isArray(candidate.items)
    ) throw new Error("Invalid dine-in order response.");

    const items = candidate.items.map((item) => {
      if (!isRecord(item) || Object.keys(item).sort().join(",") !== "lineTotalMillimes,options,productName,quantity" ||
        typeof item.productName !== "string" || !item.productName.trim() ||
        typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        typeof item.lineTotalMillimes !== "number" || !Number.isSafeInteger(item.lineTotalMillimes) || item.lineTotalMillimes < 0 ||
        !Array.isArray(item.options) || !item.options.every((option) => typeof option === "string"))
        throw new Error("Invalid dine-in order response.");
      return {
        productName: item.productName,
        quantity: item.quantity,
        lineTotalMillimes: item.lineTotalMillimes,
        options: item.options as string[],
      };
    });

    return {
      orderId: candidate.orderId,
      createdAt: candidate.createdAt,
      status: candidate.status,
      customerName: candidate.customerName,
      tableLabel: candidate.tableLabel,
      totalMillimes: candidate.totalMillimes,
      revision: candidate.revision,
      customerNotes: candidate.customerNotes,
      items,
    };
  });

  return {
    orders,
    pagination: {
      limit: expectedLimit,
      nextCursor: value.pagination.nextCursor,
    },
  };
}

async function requestPage(
  fetcher: typeof fetch,
  view: DineInOrdersView,
  scope: DineInOrdersScope,
  cursor: string | null,
): Promise<DineInOrderPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (view !== "all") query.set("status", view);
  if (scope === "today") query.set("scope", "today");
  if (cursor) query.set("cursor", cursor);

  const response = await fetcher(`/api/admin/dine-in/orders?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Dine-in orders could not be loaded.");
  return parseDineInOrderPage(await response.json(), PAGE_SIZE);
}

export function createDineInOrdersController(
  fetcher: typeof fetch = fetch,
) {
  let state: DineInOrdersState = {
    view: "in_progress",
    scope: "all",
    orders: [],
    nextCursor: null,
    loading: false,
    refreshing: false,
    loadingMore: false,
    backgroundRefreshing: false,
    backgroundRefreshFailed: false,
    error: false,
    loadMoreError: false,
    newOrderIds: [],
    lastCheckedAt: null,
  };
  let generation = 0;
  let started = false;
  let loadMoreInFlight = false;
  let refreshingGeneration: number | null = null;
  let inFlightRefresh: Promise<void> | null = null;
  let initialized = false;
  const knownOrderIds = new Set<string>();
  let statusRevision = 0;
  const localStatusChanges = new Map<string, { revision: number; status: DineInOrderStatus }>();
  const listeners = new Set<(next: DineInOrdersState) => void>();

  function update(next: DineInOrdersState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  function getSnapshot() {
    return state;
  }

  function subscribe(listener: (next: DineInOrdersState) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function compareNewest(left: DineInOrderSummary, right: DineInOrderSummary): number {
    const leftTimestamp = BigInt(left.createdAt);
    const rightTimestamp = BigInt(right.createdAt);
    if (leftTimestamp !== rightTimestamp) return leftTimestamp > rightTimestamp ? -1 : 1;
    return left.orderId === right.orderId ? 0 : left.orderId > right.orderId ? -1 : 1;
  }

  async function loadFirstPage(
    requestGeneration: number,
    view: DineInOrdersView,
    scope: DineInOrdersScope,
    options: { background?: boolean; statusRevisionAtRequest?: number } = {},
  ) {
    try {
      const page = await requestPage(fetcher, view, scope, null);
      if (requestGeneration !== generation) return;
      const background = options.background === true;
      const newlyDiscovered = background && initialized
        ? page.orders.filter((order) => !knownOrderIds.has(order.orderId)).map((order) => order.orderId)
        : [];
      const incoming = page.orders.map((order) => {
        knownOrderIds.add(order.orderId);
        const localChange = localStatusChanges.get(order.orderId);
        return localChange && localChange.revision > (options.statusRevisionAtRequest ?? statusRevision)
          ? { ...order, status: localChange.status }
          : order;
      });
      const visibleIncoming = incoming.filter((order) => matchesView(view, order.status));
      let orders: DineInOrderSummary[];
      if (background) {
        // The server answered the filtered query. A retained row it no longer
        // returns has left the filter, unless it may still live on a later page.
        const serverIds = new Set(page.orders.map((order) => order.orderId));
        const oldestServerRow = page.orders.length ? page.orders[page.orders.length - 1] : null;
        const lastPage = page.pagination.nextCursor === null;
        const retained = state.orders.filter((order) => {
          if (serverIds.has(order.orderId)) return false;
          if (view === "all") return true;
          if (lastPage || !oldestServerRow) return false;
          return compareNewest(order, oldestServerRow) > 0;
        });
        const merged = new Map(retained.map((order) => [order.orderId, order]));
        for (const order of visibleIncoming) merged.set(order.orderId, order);
        orders = [...merged.values()].sort(compareNewest);
      } else {
        orders = visibleIncoming;
      }
      initialized = true;
      update({
        ...state,
        orders,
        lastCheckedAt: Date.now(),
        nextCursor: background ? state.nextCursor : page.pagination.nextCursor,
        loading: false,
        refreshing: false,
        backgroundRefreshing: false,
        backgroundRefreshFailed: false,
        error: false,
        loadMoreError: false,
        newOrderIds: background ? newlyDiscovered : [],
      });
    } catch {
      if (requestGeneration !== generation) return;
      update({
        ...state,
        loading: false,
        refreshing: options.background ? state.refreshing : false,
        backgroundRefreshing: false,
        backgroundRefreshFailed: options.background === true,
        error: options.background ? state.error : true,
      });
    } finally {
      if (refreshingGeneration === requestGeneration) refreshingGeneration = null;
    }
  }

  function runRefresh(background: boolean): Promise<void> {
    if (state.loading || refreshingGeneration === generation) return Promise.resolve();
    generation += 1;
    const requestGeneration = generation;
    if (!background) refreshingGeneration = requestGeneration;
    update({
      ...state,
      refreshing: background ? state.refreshing : true,
      backgroundRefreshing: background,
      backgroundRefreshFailed: false,
      error: background ? state.error : false,
      loadMoreError: background ? state.loadMoreError : false,
    });
    const promise = loadFirstPage(requestGeneration, state.view, state.scope, {
      background,
      statusRevisionAtRequest: statusRevision,
    });
    inFlightRefresh = promise;
    return promise;
  }

  return {
    getSnapshot,
    subscribe,
    updateOrderStatus(orderId: string, status: DineInOrderStatus, revision?: number) {
      statusRevision += 1;
      localStatusChanges.set(orderId, { revision: statusRevision, status });
      update({
        ...state,
        orders: state.orders
          .map((order) => order.orderId === orderId
            ? { ...order, status, ...(revision === undefined ? {} : { revision }) }
            : order)
          .filter((order) => matchesView(state.view, order.status)),
      });
    },
    start() {
      if (started) return Promise.resolve();
      started = true;
      generation += 1;
      const requestGeneration = generation;
      update({ ...state, loading: true, error: false });
      return loadFirstPage(requestGeneration, state.view, state.scope);
    },
    setView(view: DineInOrdersView) {
      if (view === state.view) return Promise.resolve();
      generation += 1;
      const requestGeneration = generation;
      update({
        ...state,
        view,
        orders: [],
        nextCursor: null,
        loading: true,
        refreshing: false,
        error: false,
        loadMoreError: false,
        newOrderIds: [],
      });
      return loadFirstPage(requestGeneration, view, state.scope);
    },
    setScope(scope: DineInOrdersScope) {
      if (scope === state.scope) return Promise.resolve();
      generation += 1;
      const requestGeneration = generation;
      update({
        ...state,
        scope,
        orders: [],
        nextCursor: null,
        loading: true,
        refreshing: false,
        error: false,
        loadMoreError: false,
        newOrderIds: [],
      });
      return loadFirstPage(requestGeneration, state.view, scope);
    },
    refresh(options: { background?: boolean } = {}) {
      const background = options.background === true;
      if (background && loadMoreInFlight) return Promise.resolve();
      if (!background && state.backgroundRefreshing) {
        // A background poll is in flight. Queue this refresh behind it instead
        // of dropping it, so a conflict can still be resolved.
        const pending = inFlightRefresh ?? Promise.resolve();
        const queued = pending.then(() => runRefresh(false));
        inFlightRefresh = queued;
        return queued;
      }
      return runRefresh(background);
    },
    async loadMore() {
      const cursor = state.nextCursor;
      if (!cursor || state.loading || state.refreshing || state.backgroundRefreshing || loadMoreInFlight) return;
      loadMoreInFlight = true;
      const requestGeneration = generation;
      const view = state.view;
      const scope = state.scope;
      const statusRevisionAtRequest = statusRevision;
      update({ ...state, loadingMore: true, loadMoreError: false });
      try {
        const page = await requestPage(fetcher, view, scope, cursor);
        if (requestGeneration !== generation || state.view !== view || state.nextCursor !== cursor) return;
        const incoming = page.orders.map((order) => {
          knownOrderIds.add(order.orderId);
          const localChange = localStatusChanges.get(order.orderId);
          return localChange && localChange.revision > statusRevisionAtRequest
            ? { ...order, status: localChange.status }
            : order;
        }).filter((order) => matchesView(view, order.status));
        const seenIds = new Set(state.orders.map((order) => order.orderId));
        update({
          ...state,
          orders: [...state.orders, ...incoming.filter((order) => !seenIds.has(order.orderId))],
          nextCursor: page.pagination.nextCursor,
          loadingMore: false,
          loadMoreError: false,
        });
      } catch {
        if (requestGeneration === generation)
          update({ ...state, loadingMore: false, loadMoreError: true });
      } finally {
        loadMoreInFlight = false;
        if (state.loadingMore) update({ ...state, loadingMore: false });
      }
    },
  };
}
