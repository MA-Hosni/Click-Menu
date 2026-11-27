import { getCurrentUser } from "../../auth";
import { jsonResponse, routeError } from "../../../lib/api-security";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request.headers.get("cookie"));
    return jsonResponse({
      user,
    });
  } catch (error) {
    return routeError(error);
  }
}
