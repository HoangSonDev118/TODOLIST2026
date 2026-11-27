import { sql } from "../../../../lib/database";
import type { ScheduleScope } from "../../../../schedule/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGES_PER_TASK = 5;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

type ImageRow = { id: number; task_id: number; scope_key: string; image_data: string; created_at: string };

function getScopeKey(scope: ScheduleScope | undefined, ownerId: number | null): string | null {
  if (scope === "COMPANY") return "COMPANY";
  if (scope === "USER" && Number.isSafeInteger(ownerId) && (ownerId as number) > 0) {
    return `USER:${ownerId}`;
  }
  return null;
}

async function ensureTable(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schedule_task_images (
    id BIGSERIAL PRIMARY KEY,
    scope_key TEXT NOT NULL,
    task_id BIGINT NOT NULL,
    image_data TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (scope_key, task_id) REFERENCES schedule_task_entries(scope_key, id) ON DELETE CASCADE
  )`;
  await sql`CREATE INDEX IF NOT EXISTS schedule_task_images_task_idx ON schedule_task_images(scope_key, task_id, created_at ASC)`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") as ScheduleScope | null;
  const ownerId = params.has("ownerId") ? Number(params.get("ownerId")) : null;
  const taskId = params.has("taskId") ? Number(params.get("taskId")) : null;

  const scopeKey = getScopeKey(scope ?? undefined, ownerId);
  if (!scopeKey || !Number.isSafeInteger(taskId) || (taskId as number) < 1) {
    return Response.json({ error: "Invalid parameters." }, { status: 400 });
  }

  await ensureTable();
  const rows = (await sql`SELECT id, task_id, scope_key, image_data, created_at FROM schedule_task_images WHERE scope_key = ${scopeKey} AND task_id = ${taskId} ORDER BY created_at ASC`) as ImageRow[];
  
  const images = rows.map((row) => ({
    id: Number(row.id),
    imageData: row.image_data,
    createdAt: new Date(row.created_at).toISOString(),
  }));

  return Response.json(images, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: { scope?: ScheduleScope; ownerId?: number | null; taskId?: number; imageData?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const scopeKey = getScopeKey(body.scope, body.ownerId ?? null);
  if (!scopeKey || !Number.isSafeInteger(body.taskId) || (body.taskId as number) < 1 || !body.imageData) {
    return Response.json({ error: "Invalid parameters." }, { status: 400 });
  }

  // Validate image data (base64)
  const imageData = body.imageData;
  if (!imageData.startsWith("data:image/")) {
    return Response.json({ error: "Invalid image format. Must be a data URL." }, { status: 400 });
  }

  // Check size (rough estimate for base64)
  const base64Part = imageData.split(",")[1] ?? "";
  const estimatedSize = Math.floor(base64Part.length * 0.75);
  if (estimatedSize > MAX_IMAGE_SIZE_BYTES) {
    return Response.json({ error: "Image too large. Maximum size is 5MB." }, { status: 400 });
  }

  await ensureTable();

  // Check current image count
  const countRows = (await sql`SELECT COUNT(*)::integer AS count FROM schedule_task_images WHERE scope_key = ${scopeKey} AND task_id = ${body.taskId}`) as Array<{ count: number }>;
  const currentCount = countRows[0]?.count ?? 0;
  if (currentCount >= MAX_IMAGES_PER_TASK) {
    return Response.json({ error: `Maximum ${MAX_IMAGES_PER_TASK} images per task.` }, { status: 400 });
  }

  try {
    const rows = (await sql`INSERT INTO schedule_task_images (scope_key, task_id, image_data) VALUES (${scopeKey}, ${body.taskId}, ${imageData}) RETURNING id, task_id, image_data, created_at`) as ImageRow[];
    const savedImage = rows[0];
    if (!savedImage) {
      return Response.json({ error: "Failed to save image." }, { status: 500 });
    }
    return Response.json({
      id: Number(savedImage.id),
      imageData: savedImage.image_data,
      createdAt: new Date(savedImage.created_at).toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && /foreign key/i.test(error.message)) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") as ScheduleScope | null;
  const ownerId = params.has("ownerId") ? Number(params.get("ownerId")) : null;
  const imageId = params.has("imageId") ? Number(params.get("imageId")) : null;

  const scopeKey = getScopeKey(scope ?? undefined, ownerId);
  if (!scopeKey || !Number.isSafeInteger(imageId) || (imageId as number) < 1) {
    return Response.json({ error: "Invalid parameters." }, { status: 400 });
  }

  await ensureTable();
  const result = await sql`DELETE FROM schedule_task_images WHERE scope_key = ${scopeKey} AND id = ${imageId}`;
  
  // @ts-expect-error - rowCount is available on the result
  if (result.rowCount === 0) {
    return Response.json({ error: "Image not found." }, { status: 404 });
  }

  return Response.json({ success: true });
}
