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

export interface DineInOrderSummary {
  orderId: string;
  createdAt: string;
  status: DineInOrderStatus;
  customerName: string | null;
  tableLabel: string;
  totalMillimes: number;
}

export interface DineInOrderPage {
  orders: DineInOrderSummary[];
  pagination: { limit: number; nextCursor: string | null };
}

export interface DineInOrdersState {
  status: DineInOrderStatus | null;
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

function parsePage(value: unknown, expectedLimit: number): DineInOrderPage {
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
        "createdAt,customerName,orderId,status,tableLabel,totalMillimes" ||
      typeof candidate.orderId !== "string" || !UUID_PATTERN.test(candidate.orderId) ||
      typeof candidate.createdAt !== "string" || !parseDineInCreatedAt(candidate.createdAt) ||
      !isStatus(candidate.status) ||
      !(candidate.customerName === null || typeof candidate.customerName === "string") ||
      typeof candidate.tableLabel !== "string" || !candidate.tableLabel.trim() ||
      typeof candidate.totalMillimes !== "number" ||
      !Number.isSafeInteger(candidate.totalMillimes) || candidate.totalMillimes < 0
    ) throw new Error("Invalid dine-in order response.");

    return {
      orderId: candidate.orderId,
      createdAt: candidate.createdAt,
      status: candidate.status,
      customerName: candidate.customerName,
      tableLabel: candidate.tableLabel,
      totalMillimes: candidate.totalMillimes,
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
  status: DineInOrderStatus | null,
  cursor: string | null,
): Promise<DineInOrderPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (status) query.set("status", status);
  if (cursor) query.set("cursor", cursor);

  const response = await fetcher(`/api/admin/dine-in/orders?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Dine-in orders could not be loaded.");
  return parsePage(await response.json(), PAGE_SIZE);
}

export function createDineInOrdersController(
  fetcher: typeof fetch = fetch,
) {
  let state: DineInOrdersState = {
    status: null,
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
  };
  let generation = 0;
  let started = false;
  let loadMoreInFlight = false;
  let refreshingGeneration: number | null = null;
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
    status: DineInOrderStatus | null,
    options: { background?: boolean; statusRevisionAtRequest?: number } = {},
  ) {
    try {
      const page = await requestPage(fetcher, status, null);
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
      const visibleIncoming = status ? incoming.filter((order) => order.status === status) : incoming;
      let orders: DineInOrderSummary[];
      if (background) {
        const merged = new Map(state.orders
          .filter((order) => !status || order.status === status)
          .map((order) => [order.orderId, order]));
        for (const order of visibleIncoming) merged.set(order.orderId, order);
        orders = [...merged.values()].sort(compareNewest);
      } else {
        orders = visibleIncoming;
      }
      initialized = true;
      update({
        ...state,
        orders,
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

  return {
    getSnapshot,
    subscribe,
    updateOrderStatus(orderId: string, status: DineInOrderStatus) {
      statusRevision += 1;
      localStatusChanges.set(orderId, { revision: statusRevision, status });
      update({
        ...state,
        orders: state.orders
          .map((order) => order.orderId === orderId ? { ...order, status } : order)
          .filter((order) => !state.status || order.status === state.status),
      });
    },
    start() {
      if (started) return Promise.resolve();
      started = true;
      generation += 1;
      const requestGeneration = generation;
      update({ ...state, loading: true, error: false });
      return loadFirstPage(requestGeneration, state.status);
    },
    setStatus(status: DineInOrderStatus | null) {
      if (status === state.status) return Promise.resolve();
      generation += 1;
      const requestGeneration = generation;
      update({
        ...state,
        status,
        orders: [],
        nextCursor: null,
        loading: true,
        refreshing: false,
        error: false,
        loadMoreError: false,
        newOrderIds: [],
      });
      return loadFirstPage(requestGeneration, status);
    },
    refresh(options: { background?: boolean } = {}) {
      const background = options.background === true;
      if (background && loadMoreInFlight) return Promise.resolve();
      if (!background && state.backgroundRefreshing) return Promise.resolve();
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
      return loadFirstPage(requestGeneration, state.status, {
        background,
        statusRevisionAtRequest: statusRevision,
      });
    },
    async loadMore() {
      const cursor = state.nextCursor;
      if (!cursor || state.loading || state.refreshing || state.backgroundRefreshing || loadMoreInFlight) return;
      loadMoreInFlight = true;
      const requestGeneration = generation;
      const status = state.status;
      const statusRevisionAtRequest = statusRevision;
      update({ ...state, loadingMore: true, loadMoreError: false });
      try {
        const page = await requestPage(fetcher, status, cursor);
        if (requestGeneration !== generation || state.status !== status || state.nextCursor !== cursor) return;
        const incoming = page.orders.map((order) => {
          knownOrderIds.add(order.orderId);
          const localChange = localStatusChanges.get(order.orderId);
          return localChange && localChange.revision > statusRevisionAtRequest
            ? { ...order, status: localChange.status }
            : order;
        }).filter((order) => !status || order.status === status);
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
