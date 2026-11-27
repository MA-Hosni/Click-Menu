import { getCurrentUser } from "../../../auth";
import { createAdminTableCollectionHandlers } from "../../../../lib/admin-table-handlers";
import { createRestaurantTableStore } from "../../../../lib/table-store";
import { createTableOperations } from "../../../../lib/table-operations";

const handlers = createAdminTableCollectionHandlers({
  getCurrentUser,
  tables: createTableOperations(createRestaurantTableStore(), {
    siteUrl: process.env.SITE_URL,
  }),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
