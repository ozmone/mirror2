import Dexie from "dexie";
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
    const rows = firstOnly
      ? await db.attachments.where("[ownerType+ownerId+createdAt]").between([ownerType, ownerId, Dexie.minKey], [ownerType, ownerId, Dexie.maxKey]).first()
      : await query.toArray();
    if (!mounted.current || request !== generation.current) return;
    const orderedRows = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const next = orderedRows
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((row) => ({ id: row.id, mimeType: row.mimeType, url: URL.createObjectURL(row.blob) }));
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

/** Loads only one gallery page's image blobs; the count query never decodes image data. */
export function useAttachmentImagePage(ownerType: Attachment["ownerType"], ownerId: string, page: number, pageSize: number) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [count, setCount] = useState(0);
  const generation = useRef(0);
  const current = useRef<ImageAttachment[]>([]);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    const range = db.attachments.where("[ownerType+ownerId+createdAt]").between([ownerType, ownerId, Dexie.minKey], [ownerType, ownerId, Dexie.maxKey]);
    const [nextCount, rows] = await Promise.all([
      db.attachments.where("[ownerType+ownerId]").equals([ownerType, ownerId]).count(),
      range.offset(page * pageSize).limit(pageSize).toArray()
    ]);
    if (!mounted.current || request !== generation.current) return;
    const next = rows.map((row) => ({ id: row.id, mimeType: row.mimeType, url: URL.createObjectURL(row.blob) }));
    current.current.forEach((row) => URL.revokeObjectURL(row.url));
    current.current = next;
    setCount(nextCount);
    setImages(next);
  }, [ownerType, ownerId, page, pageSize]);
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
  return { images, count, refresh };
}
