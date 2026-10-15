"use client";
import { useState } from "react";
import type { Photo } from "@/lib/media/types";

function PhotoImage({ photo, preview }: { photo: Photo; preview: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className="photo-unavailable" role="status">
        This photo is no longer available.
      </div>
    );
  if (photo.state !== "ready")
    return (
      <div className="photo-unavailable">
        {photo.state === "failed"
          ? photo.error || "Upload failed. Remove this slot and retry."
          : `Photo ${photo.state}. Finish or remove it before submitting.`}
      </div>
    );
  const source = `/api/media/${photo.id}`;
  const thumbnailWidth =
    photo.width && photo.height
      ? Math.max(
          1,
          Math.round(
            photo.width * Math.min(1, 480 / photo.width, 480 / photo.height),
          ),
        )
      : 480;
  return (
    <figure className="mimi-photo">
      {/* Protected route rechecks the current session on every request. No image
        optimizer/public CDN may cache these account-dependent responses. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${source}?variant=thumb`}
        srcSet={
          preview || !photo.width || photo.width <= thumbnailWidth
            ? undefined
            : `${source}?variant=thumb ${thumbnailWidth}w, ${source}?variant=display ${photo.width}w`
        }
        sizes="(max-width: 600px) 90vw, 600px"
        alt={photo.description}
        width={photo.width || 480}
        height={photo.height || 480}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {preview && (
        <figcaption>
          {photo.description}
          <span>
            {photo.scanStatus === "passed"
              ? "Configured scanner passed · staff review required"
              : "Not content-scanned · publication policy applies"}
          </span>
          <a
            className="text-link"
            href={`${source}?variant=display`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View larger photo: ${photo.description} (new tab)`}
          >
            View larger photo ↗
          </a>
        </figcaption>
      )}
      {!preview && photo.scanStatus === "development_manual" && (
        <figcaption>Local development photo · not content-scanned</figcaption>
      )}
    </figure>
  );
}
export function PhotoGallery({
  photos,
  preview = false,
}: {
  photos?: Photo[];
  preview?: boolean;
}) {
  if (!photos?.length) return null;
  return (
    <div
      className={`photo-gallery ${photos.length === 1 ? "single" : ""}`}
      aria-label={
        preview ? "Private photo previews" : "Approved creator photos"
      }
    >
      {photos.map((photo) => (
        <PhotoImage key={photo.id} photo={photo} preview={preview} />
      ))}
    </div>
  );
}
