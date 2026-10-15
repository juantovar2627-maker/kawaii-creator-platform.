"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { safetyRequest } from "@/components/safety/request";
import { SocialFeedback } from "@/components/social/primitives";
import type { OwnPost } from "@/lib/social/types";
import { VideoPlayer } from "./player";
export function VideoEditor({ post }: { post: OwnPost }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const video = post.video,
    editable = post.status !== "removed";
  const refresh = () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/social") || key.startsWith("/api/admin/social")),
    );
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await safetyRequest("/api/videos", body);
      setMessage(result.message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="video-editor">
      <summary>
        Video {video ? "(1/1)" : "(0/1)"} · private until reviewed
      </summary>
      <p className="creator-help">
        One MP4 or MOV with H.264 or H.265 video, at most 100 MB and 60 seconds.
        Input is limited to 1080p and 60 frames per second; playback is resized
        within 720p. No mixed photos and videos. Only upload media you may share
        with consent; keep this community non-explicit. Videos are processed by
        a separate worker before review. Describe the action and add dialogue or
        meaningful sounds to the transcript.
      </p>
      <VideoPlayer video={video} privatePreview />
      {video && editable && (
        <>
          <form
            className="studio-form safety-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void send({
                action: "describe",
                postId: post.id,
                revision: post.revision,
                assetId: video.id,
                description: form.get("description"),
                transcript: form.get("transcript"),
              });
            }}
          >
            <label htmlFor={`video-description-${post.id}`}>
              Video description
            </label>
            <textarea
              id={`video-description-${post.id}`}
              name="description"
              defaultValue={video.description}
              required
              maxLength={1000}
              rows={3}
            />
            <label htmlFor={`video-transcript-${post.id}`}>
              Transcript / audio description (optional)
            </label>
            <textarea
              id={`video-transcript-${post.id}`}
              name="transcript"
              defaultValue={video.transcript}
              maxLength={4000}
              rows={4}
            />
            <button className="mimi-button secondary small" disabled={busy}>
              Save video description
            </button>
          </form>
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              void send({
                action: "remove",
                postId: post.id,
                revision: post.revision,
                assetId: video.id,
              })
            }
          >
            Remove video / replace upload
          </button>
        </>
      )}
      {!video && editable && !!post.photos?.length && (
        <p className="video-status">
          Remove this post’s photos before reserving a video.
        </p>
      )}
      {!video && editable && !post.photos?.length && (
        <form
          className="studio-form safety-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form),
              file = data.get("video");
            setError("");
            setMessage("");
            setProgress(0);
            if (
              !(file instanceof File) ||
              !file.size ||
              file.size > 104857600
            ) {
              setError("Choose an MP4 or MOV up to 100 MB.");
              return;
            }
            setBusy(true);
            setUploading(true);
            try {
              const slot = await safetyRequest("/api/videos", {
                action: "reserve",
                postId: post.id,
                revision: post.revision,
                bytes: file.size,
                description: data.get("description"),
                transcript: data.get("transcript"),
              });
              await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("PUT", slot.uploadUrl);
                xhr.timeout = 15 * 60 * 1000;
                if (slot.local) {
                  xhr.setRequestHeader("X-Upload-Token", slot.token);
                  xhr.setRequestHeader(
                    "Content-Type",
                    "application/octet-stream",
                  );
                }
                xhr.upload.onprogress = (event) => {
                  if (event.lengthComputable)
                    setProgress(Math.round((event.loaded / event.total) * 100));
                };
                xhr.onerror = () =>
                  reject(
                    new Error(
                      "Video upload connection failed. Remove the slot and try again.",
                    ),
                  );
                xhr.ontimeout = () =>
                  reject(
                    new Error(
                      "Video upload expired. Remove the slot and reserve another.",
                    ),
                  );
                xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) resolve();
                  else {
                    let detail =
                      "Private storage rejected the upload. Remove it and try again.";
                    if (slot.local)
                      try {
                        detail = JSON.parse(xhr.responseText).error || detail;
                      } catch {}
                    reject(new Error(detail));
                  }
                };
                xhr.send(file);
              });
              const result = await safetyRequest("/api/videos", {
                action: "complete",
                assetId: slot.id,
                token: slot.token,
              });
              setMessage(result.message);
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
          <label htmlFor={`video-file-${post.id}`}>Choose a video</label>
          <input
            id={`video-file-${post.id}`}
            name="video"
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            required
            disabled={busy}
          />
          <label htmlFor={`new-video-description-${post.id}`}>
            Describe your video
          </label>
          <textarea
            id={`new-video-description-${post.id}`}
            name="description"
            required
            maxLength={1000}
            disabled={busy}
            rows={3}
          />
          <label htmlFor={`new-video-transcript-${post.id}`}>
            Video transcript / audio description (optional)
          </label>
          <textarea
            id={`new-video-transcript-${post.id}`}
            name="transcript"
            maxLength={4000}
            disabled={busy}
            rows={4}
          />
          <button className="mimi-button secondary small" disabled={busy}>
            Upload private video
          </button>
        </form>
      )}
      {uploading && (
        <div role="status">
          <label htmlFor={`video-progress-${post.id}`}>
            Video upload {progress}%
            {progress === 100 ? " · verifying and queueing" : ""}
          </label>
          <progress
            id={`video-progress-${post.id}`}
            max={100}
            value={progress}
          />
        </div>
      )}
      <SocialFeedback message={message} error={error} />
    </details>
  );
}
