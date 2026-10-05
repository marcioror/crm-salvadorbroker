import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER = { id: "22222222-2222-2222-2222-222222222222" };

function makeDb(rows: unknown[] = []) {
  // Records every .eq(col, val) e .ilike(col, pattern) call so a bug that
  // drops the organization_id tenant filter (or the search filter) actually
  // fails a test, instead of the chain mock silently passing regardless.
  const eqCalls: Array<[string, unknown]> = [];
  const ilikeCalls: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  const terminal = { data: rows, error: null };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  chain.ilike = vi.fn((col: string, val: unknown) => {
    ilikeCalls.push([col, val]);
    return chain;
  });
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(async () => terminal);
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, eqCalls, ilikeCalls };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/leads", () => {
  it("viewer consegue buscar (role mínima é viewer)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, eqCalls } = makeDb([{ id: "lead-1", title: "Carlos" }]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/leads?search=carlos"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ id: "lead-1", title: "Carlos" }]);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");
    // Tenant isolation: a bug that drops the .eq("organization_id", ...)
    // filter must fail this test.
    expect(eqCalls).toContainEqual(["organization_id", ORG_ID]);
  });

  it("aplica ilike(title, %search%) quando search é informado", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, ilikeCalls } = makeDb([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/leads?search=Ana"));
    expect(res.status).toBe(200);
    expect(ilikeCalls).toContainEqual(["title", "%Ana%"]);
  });

  it("sem search, não chama ilike (lista sem filtro de texto)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, ilikeCalls } = makeDb([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/leads"));
    expect(res.status).toBe(200);
    expect(ilikeCalls).toEqual([]);
  });

  it("sem autenticação/role suficiente, 403 e nenhuma query é feita", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= viewer.", 403, {}),
    } as never);
    const { supabase } = makeDb();
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/leads?search=x"));
    expect(res.status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("limit inválido (>50) é rejeitado com 422", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/leads?limit=999"));
    expect(res.status).toBe(422);
  });
});
