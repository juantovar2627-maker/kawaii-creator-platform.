"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { safetyRequest } from "@/components/safety/request";
import { SocialFeedback } from "@/components/social/primitives";
import type { OwnPost } from "@/lib/social/types";
import { PhotoGallery } from "./gallery";

export function PhotoEditor({ post }: { post: OwnPost }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const refresh = () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/social") || key.startsWith("/api/admin/social")),
    );
  const editable = post.status !== "removed";
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await safetyRequest("/api/media", body);
      setMessage(result.message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const photos = post.photos || [];
  return (
    <details className="photo-editor">
      <summary>Photos ({photos.length}/5) · private until approved</summary>
      <p className="creator-help">
        JPEG, PNG or WebP, up to 10 MB each. Add only photos you own or have
        permission to share. No explicit, exploitative, non-consensual or
        identifying private content. Photos involving minors require appropriate
        consent and must never be sexualized. Editing photos returns the whole
        post to draft.
      </p>
      <PhotoGallery photos={photos} preview />
      {editable &&
        photos.map((photo, index) => (
          <div className="photo-controls" key={photo.id}>
            <form
              className="studio-form safety-form"
              onSubmit={(e) => {
                e.preventDefault();
                const description = new FormData(e.currentTarget).get(
                  "description",
                );
                void send({
                  action: "arrange",
                  postId: post.id,
                  revision: post.revision,
                  photos: photos.map((p) => ({
                    id: p.id,
                    description:
                      p.id === photo.id ? description : p.description,
                  })),
                });
              }}
            >
              <label htmlFor={`photo-description-${photo.id}`}>
                Photo {index + 1} description
              </label>
              <input
                id={`photo-description-${photo.id}`}
                name="description"
                defaultValue={photo.description}
                required
                maxLength={300}
              />
              <button className="text-link" disabled={busy}>
                Save description
              </button>
            </form>
            <div className="social-comment-actions">
              {[
                { delta: -1, name: "earlier" },
                { delta: 1, name: "later" },
              ].map(({ delta, name }) => (
                <button
                  key={name}
                  className="text-link"
                  disabled={
                    busy || index + delta < 0 || index + delta >= photos.length
                  }
                  onClick={() => {
                    const next = [...photos];
                    [next[index], next[index + delta]] = [
                      next[index + delta],
                      next[index],
                    ];
                    void send({
                      action: "arrange",
                      postId: post.id,
                      revision: post.revision,
                      photos: next.map((p) => ({
                        id: p.id,
                        description: p.description,
                      })),
                    });
                  }}
                >
                  Move photo {index + 1} {name}
                </button>
              ))}
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  void send({
                    action: "remove",
                    postId: post.id,
                    revision: post.revision,
                    assetId: photo.id,
                  })
                }
              >
                Remove photo {index + 1}
              </button>
            </div>
          </div>
        ))}
      {editable && photos.length < 5 && (
        <form
          className="studio-form safety-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form),
              file = data.get("photo");
            setError("");
            setMessage("");
            setProgress(0);
            if (!(file instanceof File) || !file.size || file.size > 10485760) {
              setError("Choose a photo up to 10 MB.");
              return;
            }
            setBusy(true);
            setUploading(true);
            try {
              const slot = await safetyRequest("/api/media", {
                action: "reserve",
                postId: post.id,
                revision: post.revision,
                description: data.get("description"),
              });
              await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("PUT", `/api/media/${slot.id}/upload`);
                xhr.timeout = 60000;
                xhr.setRequestHeader("X-Upload-Token", slot.token);
                xhr.setRequestHeader(
                  "Content-Type",
                  "application/octet-stream",
                );
                xhr.upload.onprogress = (event) => {
                  if (event.lengthComputable)
                    setProgress(Math.round((event.loaded / event.total) * 90));
                };
                xhr.onerror = () =>
                  reject(
                    new Error(
                      "Upload connection failed. Remove the incomplete slot and retry.",
                    ),
                  );
                xhr.ontimeout = () =>
                  reject(
                    new Error(
                      "Photo upload timed out. Remove the incomplete slot and retry.",
                    ),
                  );
                xhr.onload = () => {
                  let result;
                  try {
                    result = JSON.parse(xhr.responseText);
                  } catch {
                    reject(
                      new Error(
                        "Photo processing failed. Remove the incomplete slot and retry.",
                      ),
                    );
                    return;
                  }
                  if (xhr.status >= 200 && xhr.status < 300) {
                    setMessage(result.message);
                    setProgress(100);
                    resolve();
                  } else
                    reject(new Error(result.error || "Photo upload failed."));
                };
                xhr.send(file);
              });
              form.reset();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              try {
                await refresh();
              } finally {
                setBusy(false);
                setUploading(false);
              }
            }
          }}
        >
          <label htmlFor={`new-photo-${post.id}`}>Choose a photo</label>
          <input
            id={`new-photo-${post.id}`}
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            disabled={busy}
          />
          <label htmlFor={`new-photo-description-${post.id}`}>
            Describe the photo for readers using screen readers
          </label>
          <input
            id={`new-photo-description-${post.id}`}
            name="description"
            required
            maxLength={300}
            disabled={busy}
            placeholder="A lavender cardigan with star-shaped buttons"
          />
          <button className="mimi-button secondary small" disabled={busy}>
            {busy ? "Uploading / checking photo…" : "Upload private photo"}
          </button>
        </form>
      )}
      {uploading && (
        <div role="status">
          <label htmlFor={`upload-progress-${post.id}`}>
            Photo upload {progress}%
            {progress === 90 ? " · decoding and checking" : ""}
          </label>
          <progress
            id={`upload-progress-${post.id}`}
            value={progress}
            max={100}
          />
        </div>
      )}
      <SocialFeedback message={message} error={error} />
    </details>
  );
}
