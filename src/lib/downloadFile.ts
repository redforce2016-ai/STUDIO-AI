/**
 * Reliable browser file downloader designed for Cloud Run + sandboxed iFrame environments.
 * - Uses HTTP Range chunking (4 MB per chunk) when server advertises Accept-Ranges & file > 8 MB,
 *   so large MP4/ZIP files NEVER hit Cloud Run's 32 MB single-response body cap.
 * - Triggers native browser Save dialog via Blob URL + anchor download (never window.open).
 */
export async function downloadFileReliably(params: {
  url: string;
  filename: string;
  mimeType?: string;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { url, filename, mimeType = "application/octet-stream", onProgress } = params;
  onProgress?.(1);

  let totalBytes = 0;
  let supportsRanges = false;
  let detectedType = mimeType;

  try {
    const headRes = await fetch(url, { method: "HEAD", credentials: "same-origin" });
    if (headRes.ok) {
      const len = Number(headRes.headers.get("content-length") || 0);
      if (Number.isFinite(len) && len > 0) totalBytes = len;
      supportsRanges = (headRes.headers.get("accept-ranges") || "").toLowerCase().includes("bytes");
      const ct = headRes.headers.get("content-type");
      if (ct) detectedType = ct.split(";")[0].trim();
    }
  } catch {
    // Fallback to direct GET below
  }

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunks — always well under Cloud Run 32 MB limit
  let blob: Blob;

  if (supportsRanges && totalBytes > CHUNK_SIZE) {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < totalBytes) {
      const end = Math.min(totalBytes - 1, offset + CHUNK_SIZE - 1);
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: { Range: `bytes=${offset}-${end}` },
      });
      if (!res.ok && res.status !== 206) {
        throw new Error(`خطا در دریافت بخش فایل (کد ${res.status})`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      offset += buf.length;
      if (buf.length === 0) break;
      onProgress?.(Math.min(99, Math.round((offset / totalBytes) * 100)));
    }
    blob = new Blob(chunks as BlobPart[], { type: detectedType });
  } else {
    const sep = url.includes("?") ? "&" : "?";
    const downloadUrl = `${url}${sep}download=1`;
    const res = await fetch(downloadUrl, { method: "GET", credentials: "same-origin" });
    if (!res.ok) {
      throw new Error(`خطا در دانلود فایل (کد ${res.status})`);
    }
    const ct = res.headers.get("content-type");
    if (ct) detectedType = ct.split(";")[0].trim();
    const rawBlob = await res.blob();
    blob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: detectedType });
    onProgress?.(99);
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  onProgress?.(100);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
