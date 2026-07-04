const TILE_MAX_ZOOM = 19;
const TILE_USER_AGENT = "OmniVis/0.1 local mission-planning simulator";

function parseTileParam(value: string) {
  const normalized = value.endsWith(".png") ? value.slice(0, -4) : value;
  if (!/^\d+$/.test(normalized)) return null;
  return Number(normalized);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z: rawZ, x: rawX, y: rawY } = await params;
  const z = parseTileParam(rawZ);
  const x = parseTileParam(rawX);
  const y = parseTileParam(rawY);

  if (z === null || x === null || y === null || z < 0 || z > TILE_MAX_ZOOM) {
    return new Response("Invalid tile coordinate", { status: 400 });
  }

  const tileCount = 2 ** z;
  if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
    return new Response("Tile coordinate out of range", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: {
        "User-Agent": TILE_USER_AGENT,
        Accept: "image/png,image/*;q=0.8,*/*;q=0.5",
      },
      next: { revalidate: 86_400 },
    });
  } catch {
    return new Response("OpenStreetMap tile fetch blocked", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("OpenStreetMap tile unavailable", {
      status: upstream.status || 502,
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
