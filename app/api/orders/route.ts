/** Retired legacy endpoint. New order intake is exclusively the QR dine-in API. */
export async function POST() {
  return Response.json(
    { error: "Legacy order submissions are no longer supported." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
