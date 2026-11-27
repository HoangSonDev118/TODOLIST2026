import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

async function uploadToCloudinary(file: File): Promise<string> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Cloudinary chưa cấu hình. Thiếu CLOUDINARY_CLOUD_NAME hoặc UPLOAD_PRESET.");
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = file.type || "image/jpeg";

  // Create form data for Cloudinary
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: mimeType }));
  formData.append("upload_preset", uploadPreset);

  console.log("[Image Upload] Uploading to Cloudinary:", { cloudName, fileSize: file.size, mimeType });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  const data = (await response.json()) as { secure_url?: string; error?: { message?: string } };

  console.log("[Image Upload] Cloudinary response:", { status: response.ok, hasUrl: !!data.secure_url, error: data.error });

  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Upload Cloudinary thất bại.");
  }

  return data.secure_url;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Không tìm thấy file." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File không phải là hình ảnh." }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json({ error: `Kích thước quá lớn. Tối đa ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB.` }, { status: 400 });
    }

    const imageUrl = await uploadToCloudinary(file);
    return NextResponse.json({ imageUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload thất bại.";
    console.error("[Image Upload] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
