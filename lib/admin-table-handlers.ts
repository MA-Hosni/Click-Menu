import {
  ApiError,
  assertSameOrigin,
  jsonResponse,
  readBoundedJson,
  requireAdmin,
  routeError,
  type RequestIdentity,
} from "./api-security";
import { toTableApiError } from "./table-operations";

type TableOperations = {
  list(): Promise<unknown[]>;
  create(label: unknown): Promise<unknown>;
  update(id: string, changes: { label?: string; isActive?: boolean }): Promise<unknown>;
  rotate(id: string, rotationId: unknown, expectedVersion: unknown): Promise<unknown>;
  recover(id: string): Promise<unknown>;
};

function respondWithError(error: unknown): Response {
  return routeError(toTableApiError(error) ?? error);
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError("Send a valid table request.", 400);
  return value as Record<string, unknown>;
}

export function createAdminTableCollectionHandlers(dependencies: {
  getCurrentUser: () => Promise<RequestIdentity | null>;
  tables: TableOperations;
}) {
  return {
    async GET(): Promise<Response> {
      try {
        requireAdmin(await dependencies.getCurrentUser());
        return jsonResponse({ tables: await dependencies.tables.list() });
      } catch (error) {
        return respondWithError(error);
      }
    },
    async POST(request: Request): Promise<Response> {
      try {
        requireAdmin(await dependencies.getCurrentUser());
        assertSameOrigin(request);
        const payload = readObject(await readBoundedJson(request, 2_000));
        return jsonResponse(await dependencies.tables.create(payload.label), 201);
      } catch (error) {
        return respondWithError(error);
      }
    },
  };
}

export function createAdminTableItemHandlers(dependencies: {
  getCurrentUser: () => Promise<RequestIdentity | null>;
  tables: TableOperations;
}) {
  return {
    async PATCH(request: Request, id: string): Promise<Response> {
      try {
        requireAdmin(await dependencies.getCurrentUser());
        assertSameOrigin(request);
        const payload = readObject(await readBoundedJson(request, 2_000));
        if (Object.keys(payload).some((key) => key !== "label" && key !== "isActive"))
          throw new ApiError("Send a valid table request.", 400);
        return jsonResponse(
          await dependencies.tables.update(id, {
            label: payload.label as string | undefined,
            isActive: payload.isActive as boolean | undefined,
          }),
        );
      } catch (error) {
        return respondWithError(error);
      }
    },
    async rotate(request: Request, id: string): Promise<Response> {
      try {
        requireAdmin(await dependencies.getCurrentUser());
        assertSameOrigin(request);
        const payload = readObject(await readBoundedJson(request, 2_000));
        if (
          Object.keys(payload).some(
            (key) => key !== "rotationId" && key !== "expectedVersion",
          )
        )
          throw new ApiError("Send a valid table request.", 400);
        return jsonResponse(
          await dependencies.tables.rotate(
            id,
            payload.rotationId,
            payload.expectedVersion,
          ),
        );
      } catch (error) {
        return respondWithError(error);
      }
    },
    async recover(id: string): Promise<Response> {
      try {
        requireAdmin(await dependencies.getCurrentUser());
        return jsonResponse(await dependencies.tables.recover(id));
      } catch (error) {
        return respondWithError(error);
      }
    },
  };
}
