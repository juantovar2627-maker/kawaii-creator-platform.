"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { categories, filterCreators } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import { CreatorCard } from "./creator-card";
import { EmptyState } from "./primitives";
import { RealCreatorCard } from "@/components/creators/public-profile";
import type { PublicCreator } from "@/lib/creators/presets";

export function DiscoverDirectory({
  realCreators = [],
}: {
  realCreators?: PublicCreator[];
}) {
  const params = useSearchParams();
  const initialCategory = params.get("category") || "All creators";
  const [query, setQuery] = useState(params.get("q") || "");
  const [category, setCategory] = useState(
    categories.includes(initialCategory as (typeof categories)[number])
      ? initialCategory
      : "All creators",
  );
  const [sort, setSort] = useState("featured");
  const { state } = useDemo();
  const filtered = filterCreators(query, category, state.blocked);
  const search = query.trim().toLowerCase();
  const realFiltered = realCreators.filter(
    (creator) =>
      (category === "All creators" ||
        creator.categories.some((item) => item === category)) &&
      [
        creator.displayName,
        creator.username,
        creator.biography,
        ...creator.categories,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search),
  );
  if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "name")
    realFiltered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <>
      <div className="directory-tools">
        <div className="directory-search">
          <Search size={19} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search the creator directory"
            placeholder="A name, a style, a little inspiration…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <label className="directory-sort">
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span className="sr-only">Sort creators</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="featured">Featured first</option>
            <option value="name">Name: A–Z</option>
          </select>
        </label>
      </div>
      <div className="category-filters" aria-label="Creator categories">
        {categories.map((item) => (
          <button
            key={item}
            className={`filter-pill ${category === item ? "selected" : ""}`}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <p className="result-count" role="status">
        {realFiltered.length} community creators · {filtered.length} fictional
        examples
      </p>
      {realFiltered.length > 0 && (
        <section aria-label="Community creators">
          <h2 className="directory-section-title">From our community</h2>
          <div className="creator-grid">
            {realFiltered.map((creator) => (
              <RealCreatorCard key={creator.username} creator={creator} />
            ))}
          </div>
        </section>
      )}
      {filtered.length > 0 && (
        <h2 className="directory-section-title">Meet the demo community</h2>
      )}
      {filtered.length ? (
        <div className="creator-grid">
          {filtered.map((creator, index) => (
            <CreatorCard
              key={creator.id}
              creator={creator}
              featured={index < 2 && sort === "featured"}
            />
          ))}
        </div>
      ) : !realFiltered.length ? (
        <EmptyState
          title="A little quiet here"
          action="Clear filters"
          onAction={() => {
            setQuery("");
            setCategory("All creators");
          }}
        >
          Try a different name or category. Blocked demo creators are hidden
          from these results.
        </EmptyState>
      ) : null}
    </>
  );
}
