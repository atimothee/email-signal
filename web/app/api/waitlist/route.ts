import { NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Honest stub: there is no server-side database wired up yet (we're pre-launch).
 * The form posts here so the UI is real, the email is validated, and we don't
 * silently throw it away. We log to the request log so a deployment can grep
 * for early signups. When a real CRM is chosen, swap the body of this handler.
 */
export async function POST(req: Request) {
  try {
    const { email } = (await req.json()) as { email?: string };
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }
    console.log("[waitlist] signup", { email, ts: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
