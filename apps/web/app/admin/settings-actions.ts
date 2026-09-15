"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "../../lib/org-data";
import { createServiceClient } from "../../lib/supabase/service";

export async function updateApiNinjasKey(formData: FormData) {
  await requirePlatformAdmin();
  const key = String(formData.get("api_ninjas_key") ?? "").trim();
  const service = createServiceClient();
  const { error } = await service
    .from("platform_settings")
    .update({ api_ninjas_key: key || null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
