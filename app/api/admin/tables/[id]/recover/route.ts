import { getCurrentUser } from "../../../../../auth";
import { createAdminTableItemHandlers } from "../../../../../../lib/admin-table-handlers";
import { createRestaurantTableStore } from "../../../../../../lib/table-store";
import { createTableOperations } from "../../../../../../lib/table-operations";

const handlers = createAdminTableItemHandlers({
  getCurrentUser,
  tables: createTableOperations(createRestaurantTableStore(), {
    siteUrl: process.env.SITE_URL,
  }),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlers.recover((await params).id);
}
