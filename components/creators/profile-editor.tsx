"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  avatars,
  banners,
  creatorCategories,
  themes,
  type OwnCreator,
} from "@/lib/creators/presets";

export function CreatorProfileEditor({
  initialProfile,
}: {
  initialProfile: OwnCreator | null;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(initialProfile?.theme || "pink");
  const [avatar, setAvatar] = useState(initialProfile?.avatar || "flower");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    const input = {
      ...payload,
      categories: form.getAll("categories"),
      communityAccepted: form.get("communityAccepted") === "on",
    };
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/creator-profile", {
        method: profile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "We could not save your profile.");
        return;
      }
      setProfile(result.profile);
      setMessage(
        profile
          ? "Your creator profile is saved."
          : "Your creator space is ready.",
      );
      router.refresh();
    } catch {
      setError("We could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="creator-editor-layout">
      <section className="account-panel">
        <p className="eyebrow">A LITTLE MORE YOU</p>
        <h1>My Creator Space</h1>
        <p className="intro-description">
          An opt-in public profile, made for your kind of creativity. Your
          private account settings stay separate.
        </p>
        <div className="creator-policy-note">
          <strong>Start small. Stay in control.</strong>
          <p>
            New profiles are unlisted: anyone with your link can visit, but you
            won’t appear in Discover. Hide your profile at any time. Discovery
            requests require moderator approval. Decisions and requests for
            another review are available in Community Safety.
          </p>
        </div>
        {profile?.moderationStatus === "suspended" && (
          <p role="status" className="creator-error">
            Your public profile is unavailable following a moderation
            restriction. Editing cannot remove this restriction.
          </p>
        )}
        {profile && (
          <div className="creator-policy-note">
            <strong>Moderation status: {profile.moderationStatus}</strong>
            {profile.moderationReason && (
              <p className="creator-text">{profile.moderationReason}</p>
            )}
            <Link className="text-link" href="/dashboard/safety">
              Decision history and review requests ↗
            </Link>
            {profile.moderationStatus === "rejected" && (
              <p>
                Edit your profile to address the reason and submit it for review
                again.
              </p>
            )}
          </div>
        )}
        <form className="studio-form creator-editor" onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend className="sr-only">Creator profile details</legend>
            <label htmlFor="creator-username">Username</label>
            <input
              id="creator-username"
              name="username"
              defaultValue={profile?.username || ""}
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z][A-Za-z0-9_]{2,29}"
              autoComplete="off"
              aria-describedby="username-help"
            />
            <p id="username-help" className="creator-help">
              3–30 letters, numbers, or underscores. Starts with a letter. Saved
              in lowercase. Changing it changes your public URL.
            </p>
            <label htmlFor="creator-name">Creator display name</label>
            <input
              id="creator-name"
              name="displayName"
              defaultValue={profile?.displayName || ""}
              required
              maxLength={80}
              autoComplete="nickname"
            />
            <label htmlFor="creator-bio">Biography</label>
            <textarea
              id="creator-bio"
              name="biography"
              defaultValue={profile?.biography || ""}
              maxLength={1000}
              rows={5}
              placeholder="Your style, your art, your little world…"
            />
            <div className="creator-field-grid">
              <div>
                <label htmlFor="creator-theme">Profile colors</label>
                <select
                  id="creator-theme"
                  name="theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                >
                  {Object.entries(themes).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="creator-avatar">Avatar preset</label>
                <select
                  id="creator-avatar"
                  name="avatar"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value as typeof avatar)}
                >
                  {Object.entries(avatars).map(([key, symbol]) => (
                    <option key={key} value={key}>
                      {symbol} {key}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="creator-banner">Banner preset</label>
                <select
                  id="creator-banner"
                  name="banner"
                  defaultValue={profile?.banner || "blossom"}
                >
                  {Object.entries(banners).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="creator-categories">
              <legend>
                Creator categories <span>(choose 1–3)</span>
              </legend>
              {creatorCategories.map((category) => (
                <label key={category}>
                  <input
                    type="checkbox"
                    name="categories"
                    value={category}
                    defaultChecked={profile?.categories.includes(category)}
                  />
                  {category}
                </label>
              ))}
            </fieldset>
            <h2>Elsewhere on the internet</h2>
            <p className="creator-help">
              Optional public HTTPS links. These will appear on your public
              profile.
            </p>
            <label htmlFor="creator-website">Website</label>
            <input
              id="creator-website"
              type="url"
              name="websiteUrl"
              defaultValue={profile?.websiteUrl || ""}
              placeholder="https://your-website.com"
              maxLength={300}
            />
            <label htmlFor="creator-instagram">Instagram</label>
            <input
              id="creator-instagram"
              type="url"
              name="instagramUrl"
              defaultValue={profile?.instagramUrl || ""}
              placeholder="https://www.instagram.com/yourname"
              maxLength={300}
            />
            <label htmlFor="creator-youtube">YouTube</label>
            <input
              id="creator-youtube"
              type="url"
              name="youtubeUrl"
              defaultValue={profile?.youtubeUrl || ""}
              placeholder="https://www.youtube.com/@yourname"
              maxLength={300}
            />
            <label htmlFor="creator-visibility">
              Public profile visibility
            </label>
            <select
              id="creator-visibility"
              name="visibility"
              defaultValue={profile?.visibility || "unlisted"}
              aria-describedby="visibility-help"
            >
              <option value="unlisted">
                Unlisted — accessible with your link
              </option>
              <option value="hidden">
                Hidden / deactivated — only your owner preview
              </option>
              <option value="listed">
                Request Discover listing — approval required
              </option>
            </select>
            <p id="visibility-help" className="creator-help">
              Listing requests remain accessible by direct link while awaiting
              review. Editing a profile resets its discovery approval. Hidden
              profiles return 404 to all public visitors.
            </p>
            <label className="creator-agreement">
              <input
                type="checkbox"
                name="communityAccepted"
                required
                defaultChecked={!!profile}
              />
              <span>
                I agree to the{" "}
                <Link className="text-link" href="/community-guidelines">
                  non-explicit community rules
                </Link>
                . My profile and links will be respectful and suitable for this
                community.
              </span>
            </label>
            <button className="mimi-button primary" type="submit">
              {busy
                ? "Saving your space…"
                : profile
                  ? "Save creator profile"
                  : "Create creator profile"}
            </button>
          </fieldset>
          {error && (
            <p role="alert" className="creator-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="creator-success">
              {message}
            </p>
          )}
        </form>
      </section>
      <aside className="creator-editor-aside">
        <div
          className="account-panel creator-preview-card"
          style={{ backgroundColor: themes[theme].color }}
        >
          <span className="preset-avatar" aria-hidden="true">
            {avatars[avatar]}
          </span>
          <h2>Your kind of magic.</h2>
          <p>
            Choose your colors, tell your story, and make this little corner
            yours.
          </p>
        </div>
        <div className="account-panel">
          <h2>Your space, at a glance</h2>
          {profile ? (
            <>
              <p>
                <strong>@{profile.username}</strong>
              </p>
              <p>
                {profile.visibility === "hidden"
                  ? "Hidden / deactivated"
                  : profile.visibility === "listed" &&
                      profile.moderationStatus === "approved"
                    ? "Listed in Discover"
                    : "Unlisted · link access only"}
              </p>
              {profile.visibility === "listed" &&
                profile.moderationStatus === "pending" && (
                  <p>
                    Discovery request pending. A moderator will review your
                    saved profile before it appears in Discover.
                  </p>
                )}
              <p className="creator-help">
                Created{" "}
                {new Date(profile.createdAt).toLocaleDateString("en-US", {
                  timeZone: "UTC",
                })}
                <br />
                Updated{" "}
                {new Date(profile.updatedAt).toLocaleDateString("en-US", {
                  timeZone: "UTC",
                })}
              </p>
              <div className="creator-link-stack">
                <Link
                  className="mimi-button secondary"
                  href="/dashboard/creator-space/preview"
                >
                  Preview saved profile
                </Link>
                {profile.visibility !== "hidden" &&
                  profile.moderationStatus !== "suspended" && (
                    <Link
                      className="text-link"
                      href={`/creators/${profile.username}`}
                    >
                      Visit public page ↗
                    </Link>
                  )}
              </div>
            </>
          ) : (
            <p>
              Creating a profile is optional. Your account works without one.
            </p>
          )}
          <p className="creator-help">
            No uploads, publishing, messaging, or payments are enabled.
          </p>
        </div>
      </aside>
    </div>
  );
}
