import { createDineInOrderPostHandler } from "../../../../features/orders/order-api";
import { submitDineInOrder } from "../../../../features/orders/order-service";
import { isDineInOrderIntakeEnabled } from "../../../../features/orders/order-intake";
import { postgresRateLimitStore } from "../../../../lib/rate-limit-store";

export const POST = createDineInOrderPostHandler({
  isIntakeEnabled: isDineInOrderIntakeEnabled,
  submit: (request, idempotencyKey) => submitDineInOrder.submit(request, idempotencyKey),
  getRateLimitStore: postgresRateLimitStore,
});
