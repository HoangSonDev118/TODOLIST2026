"use client";

import { useEffect, useState } from "react";
import type { ScheduleScope } from "../lib/types";

interface TaskImageThumbnailProps {
  taskId: number;
  scope: ScheduleScope;
  ownerId: number | null;
}

export function TaskImageThumbnail({ taskId, scope, ownerId }: TaskImageThumbnailProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ scope, taskId: String(taskId) });
    if (scope === "USER" && ownerId !== null) params.set("ownerId", String(ownerId));

    const loadImage = async () => {
      try {
        const response = await fetch(`/api/schedule/tasks/images?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load");
        const images = await response.json() as Array<{ id: number; imageUrl: string }>;
        if (active && images.length > 0) {
          setImageUrl(images[0].imageUrl);
        }
      } catch {
        // Silently fail
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadImage();
    return () => { active = false; };
  }, [taskId, scope, ownerId]);

  if (loading || !imageUrl) return null;

  return (
    <div className="mt-1.5 overflow-hidden rounded-md bg-black/20">
      <img
        src={imageUrl}
        alt={`Ảnh task ${taskId}`}
        className="h-auto w-full object-cover"
        loading="lazy"
        style={{ maxHeight: 80 }}
      />
    </div>
  );
}
