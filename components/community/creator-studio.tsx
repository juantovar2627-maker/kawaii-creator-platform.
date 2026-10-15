"use client";

import { useEffect, useState } from "react";
import { ImagePlus, LockKeyhole, Save } from "lucide-react";
import { useDemo } from "./demo-provider";
import { DemoNotice } from "./primitives";

const draftKey = "mimi-creator-draft-v1";
export function CreatorStudio() {
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [type, setType] = useState("photo");
  const { notify } = useDemo();
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || "{}");
      if (typeof draft.title === "string") setTitle(draft.title.slice(0, 100));
      if (typeof draft.caption === "string")
        setCaption(draft.caption.slice(0, 2000));
      if (draft.type === "photo" || draft.type === "video") setType(draft.type);
    } catch {
      /* A malformed local draft must not affect the account. */
    }
  }, []);
  return (
    <>
      <DemoNotice>
        Drafts are saved only on this device, not to your account. Uploads,
        public publishing, and memberships are not connected yet.
      </DemoNotice>
      <form
        className="studio-form account-panel"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            localStorage.setItem(
              draftKey,
              JSON.stringify({
                title: title.trim(),
                caption: caption.trim(),
                type,
              }),
            );
            notify(
              "Creative draft saved in this browser. Nothing has been published.",
            );
          } catch {
            notify(
              "Browser storage is unavailable. Copy your draft before leaving this page.",
            );
          }
        }}
      >
        <label htmlFor="draft-title">Give your idea a little name</label>
        <input
          id="draft-title"
          placeholder="Something lovely is taking shape…"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={100}
          required
        />
        <label htmlFor="draft-type">Post format</label>
        <select
          id="draft-type"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="photo">Photo post</option>
          <option value="video">Video post</option>
        </select>
        <div className="studio-upload">
          <ImagePlus size={27} aria-hidden="true" />
          <strong>A place for your creative world</strong>
          <span>Photo and video uploads are a future feature.</span>
        </div>
        <label htmlFor="draft-caption">Tell a little story</label>
        <textarea
          id="draft-caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="An outfit story, a creative process, a moment worth keeping…"
        />
        <div className="flex flex-wrap gap-3 mt-2">
          <button type="submit" className="mimi-button primary">
            <Save size={16} aria-hidden="true" />
            Save a local draft
          </button>
          <button type="button" className="mimi-button secondary" disabled>
            <LockKeyhole size={15} aria-hidden="true" />
            Publishing unavailable
          </button>
        </div>
      </form>
    </>
  );
}
