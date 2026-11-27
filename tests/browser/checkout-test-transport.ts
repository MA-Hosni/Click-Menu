import {
  postDineInSubmission,
  type PendingDineInSubmission,
} from "../../features/storefront/dine-in-order";

/** A harness-only transport. It has no path to the production order endpoint. */
export function postBrowserTestSubmission(
  operation: PendingDineInSubmission,
  fetcher: typeof fetch = fetch,
) {
  return postDineInSubmission(operation, async (_input, init) => {
    const response = await fetcher("/browser-test/order-mock", { ...init, redirect: "error" });
    if (response.redirected) throw new TypeError("Browser test transport rejected a redirect.");
    return response;
  });
}
