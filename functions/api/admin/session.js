import { errorResponse, json } from "../../_shared/http.js";
import { requireAdmin } from "../../_shared/auth.js";

export async function onRequestGet(context) {
  try {
    const admin = await requireAdmin(context);
    return json({ ok: true, admin });
  } catch (error) {
    return errorResponse(error);
  }
}
