import "server-only";

import { randomUUID } from "node:crypto";
import { ApiError } from "./api-security";
import {
  CatalogValidationError,
  upgradeStoredCatalog,
  validateTndCatalog,
} from "./catalog-validation";
import type { Catalog } from "./types";

export type StoredCatalog = {
  payload: string;
  revision: number;
  tndReviewedRevision?: number | null;
  tndReviewedAt?: number | null;
};

export interface CatalogReviewState {
  revision: number;
  reviewedRevision: number | null;
  reviewedAt: number | null;
}

export interface CatalogPersistence {
  read(): Promise<StoredCatalog | null>;
  create(payload: string, revision: number, updatedAt: number): Promise<boolean>;
  update(
    expectedRevision: number,
    payload: string,
    revision: number,
    updatedAt: number,
  ): Promise<boolean>;
  review(
    expectedRevision: number,
    reviewedAt: number,
    expectedPayload: string,
    eventId: string,
    actor: string,
  ): Promise<boolean>;
}

function toCatalog(row: StoredCatalog): Catalog {
  const catalog = upgradeStoredCatalog(JSON.parse(row.payload)) as Catalog;
  return validateTndCatalog({ ...catalog, revision: row.revision });
}

function reviewState(row: StoredCatalog | null): CatalogReviewState {
  return {
    revision: row?.revision ?? 0,
    reviewedRevision: row?.tndReviewedRevision ?? null,
    reviewedAt: row?.tndReviewedAt ?? null,
  };
}

export function createCatalogOperations(persistence: CatalogPersistence) {
  return {
    async read(): Promise<Catalog | null> {
      const row = await persistence.read();
      return row ? toCatalog(row) : null;
    },

    async readReviewState(): Promise<CatalogReviewState> {
      return reviewState(await persistence.read());
    },

    async review(expectedRevisionValue: unknown, actor: string): Promise<CatalogReviewState> {
      if (
        typeof expectedRevisionValue !== "number" ||
        !Number.isSafeInteger(expectedRevisionValue) ||
        expectedRevisionValue < 1
      )
        throw new ApiError("Reload the saved menu before reviewing its prices.", 400);

      const row = await persistence.read();
      if (!row || row.revision !== expectedRevisionValue)
        throw new ApiError("The saved menu changed. Reload it before reviewing prices.", 409);

      try {
        validateTndCatalog(toCatalog(row));
      } catch (error) {
        if (error instanceof CatalogValidationError)
          throw new ApiError(error.message, 422);
        throw error;
      }

      const reviewedAt = Date.now();
      const reviewed = await persistence.review(
        expectedRevisionValue,
        reviewedAt,
        row.payload,
        randomUUID(),
        actor,
      );
      if (!reviewed)
        throw new ApiError("The saved menu changed during review. Reload it and try again.", 409);

      return {
        revision: expectedRevisionValue,
        reviewedRevision: expectedRevisionValue,
        reviewedAt,
      };
    },

    async save(catalog: Catalog): Promise<Catalog> {
      validateTndCatalog(catalog);
      const next = { ...catalog, revision: catalog.revision + 1 };
      const payload = JSON.stringify(next);
      const updatedAt = Date.now();
      const saved =
        catalog.revision === 0
          ? await persistence.create(payload, next.revision, updatedAt)
          : await persistence.update(
              catalog.revision,
              payload,
              next.revision,
              updatedAt,
            );
      if (!saved)
        throw new ApiError(
          "This menu was changed in another tab. Reload the latest version before saving.",
          409,
        );
      return next;
    },
  };
}
