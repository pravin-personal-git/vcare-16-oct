import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { apiTokenFromBearer } from '@/server/api-tokens';

/**
 * A minimal authenticated REST surface for the "MCP Connector" /
 * "ChatGPT/OpenAI Connector" settings cards - proving the token system
 * actually works, not a certified MCP server.
 *
 * A real MCP server speaks JSON-RPC 2.0 with tool/resource negotiation
 * (the `@modelcontextprotocol/sdk` protocol) - that is a protocol
 * implementation in its own right, not something to fake here. What this
 * route gives an external agent today is the same bearer-token shape as
 * `call-logs/sync`/`attendance/devices/sync`, with a small, explicit set of
 * read-only tools. Wiring a real MCP/JSON-RPC server against
 * `apiTokenFromBearer` is the natural next step if genuine Claude Desktop/
 * Code tool-calling is wanted later.
 */

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

const TOOLS = ['list_stores', 'list_leads', 'list_recent_orders'] as const;
type Tool = (typeof TOOLS)[number];

export async function GET(req: Request) {
  const auth = await apiTokenFromBearer(bearer(req));
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or revoked token.', authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    organization: { id: auth.organizationId, name: auth.organizationName },
    availableTools: TOOLS,
  });
}

export async function POST(req: Request) {
  try {
    const auth = await apiTokenFromBearer(bearer(req));
    if (!auth) {
      return NextResponse.json({ error: 'Invalid or revoked token.', authenticated: false }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const tool = body?.tool as Tool | undefined;
    if (!tool || !TOOLS.includes(tool)) {
      return NextResponse.json({ error: `Send { "tool": one of ${TOOLS.join(', ')} }.` }, { status: 400 });
    }

    const stores = await db.store.findMany({
      where: { organizationId: auth.organizationId },
      select: { id: true, name: true, branchCode: true, isActive: true },
    });
    const storeIds = stores.map((s) => s.id);

    switch (tool) {
      case 'list_stores':
        return NextResponse.json({ stores });

      case 'list_leads': {
        const leads = await db.lead.findMany({
          where: { storeId: { in: storeIds } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, leadCode: true, firstName: true, lastName: true, businessName: true, createdAt: true },
        });
        return NextResponse.json({ leads });
      }

      case 'list_recent_orders': {
        const orders = await db.salesOrder.findMany({
          where: { storeId: { in: storeIds } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, orderNo: true, customerName: true, grandTotalPaise: true, fulfilmentStatus: true, createdAt: true },
        });
        return NextResponse.json({ orders });
      }
    }
  } catch (err) {
    console.error('[api/mcp]', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
