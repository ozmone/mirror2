import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import type { Attachment } from "../../types";

type ImageAttachment = { id: string; url: string; mimeType: string };

/** Own object URLs independently of render state, including late async results. */
export function useAttachmentImages(ownerType: Attachment["ownerType"], ownerId: string, firstOnly = false) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const generation = useRef(0);
  const current = useRef<ImageAttachment[]>([]);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    const query = db.attachments.where("[ownerType+ownerId]").equals([ownerType, ownerId]);
    const rows = await (firstOnly ? query.limit(1) : query).toArray();
    if (!mounted.current || request !== generation.current) return;
    const next = rows.map((row) => ({ id: row.id, mimeType: row.mimeType, url: URL.createObjectURL(row.blob) }));
    current.current.forEach((row) => URL.revokeObjectURL(row.url));
    current.current = next;
    setImages(next);
  }, [ownerType, ownerId, firstOnly]);
  useEffect(() => {
    mounted.current = true;
    setImages([]);
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
      current.current.forEach((row) => URL.revokeObjectURL(row.url));
      current.current = [];
    };
  }, [refresh]);
  return { images, refresh };
}
