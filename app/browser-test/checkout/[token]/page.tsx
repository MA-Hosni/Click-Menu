import { connection } from "next/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import CheckoutBrowserHarness from "../../../../tests/browser/CheckoutBrowserHarness";
import { isLoopbackBrowserTestRequest } from "../../request-guard";

const syntheticTokens = new Set(["A".repeat(43), "C".repeat(43)]);

export default async function CheckoutBrowserPage({ params }: { params: Promise<{ token: string }> }) {
  if (process.env.NODE_ENV !== "development" || process.env.CLICKMENU_CHECKOUT_BROWSER_TEST !== "1")
    notFound();
  if (!isLoopbackBrowserTestRequest(await headers())) notFound();
  await connection();
  const { token } = await params;
  if (!syntheticTokens.has(token)) notFound();
  return <CheckoutBrowserHarness tableToken={token} />;
}
