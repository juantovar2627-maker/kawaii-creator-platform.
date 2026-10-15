// Fictional editorial content only. Never join these IDs to Postgres users.
export const categories = [
  "All creators",
  "Fashion & style",
  "Cosplay",
  "Art & illustration",
  "Lifestyle",
  "Gaming",
] as const;
export type Category = (typeof categories)[number];
export type Artwork = "fashion" | "art" | "cosplay" | "lifestyle" | "community";

export type Creator = {
  id: string;
  name: string;
  username: string;
  pronouns: string;
  category: Category;
  tagline: string;
  bio: string;
  followers: string;
  location: string;
  color: string;
  portrait: string;
  art: Artwork;
  tags: string[];
};

export const creators: Creator[] = [
  {
    id: "yuki",
    name: "Yuki Bloom",
    username: "yukibloom",
    pronouns: "they / he",
    category: "Fashion & style",
    tagline: "Soft fits. Big feelings. Tiny bows.",
    bio: "A wardrobe full of pastels and a head full of daydreams. Sharing femboy fashion, thrifted treasures, and the little things that make self-expression feel like home.",
    followers: "12.8k",
    location: "A sunny little studio",
    color: "#f9dbe4",
    portrait: "58% 39%",
    art: "fashion",
    tags: ["Pastel style", "Femboy fashion", "Thrifting"],
  },
  {
    id: "luna",
    name: "Luna Moon",
    username: "lunamoon",
    pronouns: "they / them",
    category: "Cosplay",
    tagline: "A little fantasy in the everyday.",
    bio: "Making costumes, collecting ribbons, and bringing favorite characters to life. Come for the sparkly details, stay for the very chaotic behind-the-scenes.",
    followers: "8.4k",
    location: "Somewhere among the stars",
    color: "#e7def9",
    portrait: "92% 43%",
    art: "cosplay",
    tags: ["Cosplay", "Costume making", "Fantasy"],
  },
  {
    id: "kai",
    name: "Kai Studio",
    username: "kaistudio",
    pronouns: "he / they",
    category: "Art & illustration",
    tagline: "Drawing a softer kind of world.",
    bio: "Illustrator, sketchbook enthusiast, and professional tea-forgetter. A space for playful color studies, cozy drawings, and making art without the pressure to be perfect.",
    followers: "6.2k",
    location: "At the drawing desk",
    color: "#f9e7cc",
    portrait: "73% 17%",
    art: "art",
    tags: ["Digital art", "Sketchbooks", "Creative process"],
  },
  {
    id: "momo",
    name: "Momo Peach",
    username: "momopeach",
    pronouns: "she / they",
    category: "Lifestyle",
    tagline: "Romanticizing the small things.",
    bio: "Slow mornings, cozy corners, and an ever-growing collection of mugs. Sharing tiny rituals that turn ordinary days into something lovely.",
    followers: "4.7k",
    location: "The cozy corner",
    color: "#f9ded2",
    portrait: "57% 39%",
    art: "lifestyle",
    tags: ["Cozy living", "Slow mornings", "Little rituals"],
  },
  {
    id: "ren",
    name: "Ren Cloud",
    username: "rencloud",
    pronouns: "he / him",
    category: "Fashion & style",
    tagline: "Personal style, without the rules.",
    bio: "Mixing oversized knits, dreamy layers, and whatever makes me smile. A little reminder that you get to define your own kind of cute.",
    followers: "3.5k",
    location: "Between the thrift racks",
    color: "#dcebe4",
    portrait: "73% 17%",
    art: "fashion",
    tags: ["Layering", "Soft streetwear", "Self-expression"],
  },
  {
    id: "sol",
    name: "Sol Sprout",
    username: "solsprout",
    pronouns: "they / them",
    category: "Gaming",
    tagline: "Cozy games and good company.",
    bio: "Building tiny digital gardens and very elaborate cozy-game playlists. Pull up a cushion for a gentle play session and a little creative inspiration.",
    followers: "2.9k",
    location: "On a tiny digital island",
    color: "#e4e1fa",
    portrait: "92% 43%",
    art: "lifestyle",
    tags: ["Cozy gaming", "World building", "Community"],
  },
];

export type DemoPost = {
  id: string;
  creatorId: string;
  title: string;
  caption: string;
  art: Artwork;
  type: "photo" | "video";
  likes: number;
  time: string;
  comments: { name: string; text: string }[];
};
export const posts: DemoPost[] = [
  {
    id: "sunday-softness",
    creatorId: "yuki",
    title: "A little Sunday softness",
    caption:
      "Today’s outfit recipe: one thrifted cardigan, two tiny bows, and a little courage to be yourself. 🌷 What’s your comfort outfit?",
    art: "fashion",
    type: "photo",
    likes: 248,
    time: "2 hours ago",
    comments: [
      { name: "Luna · demo", text: "The tiny bows make everything better ♡" },
    ],
  },
  {
    id: "sketchbook-morning",
    creatorId: "kai",
    title: "A page from my morning",
    caption:
      "No perfect lines today. Just strawberries, a sleepy cat, and some colors that feel like a hug. 🍓",
    art: "art",
    type: "photo",
    likes: 186,
    time: "3 hours ago",
    comments: [{ name: "Momo · demo", text: "This is my kind of morning." }],
  },
  {
    id: "moonlight-details",
    creatorId: "luna",
    title: "Made of little details",
    caption:
      "The final cape is coming together! A little star embroidery goes a long way. Here’s a peek from the costume corner. ✨",
    art: "cosplay",
    type: "photo",
    likes: 312,
    time: "4 hours ago",
    comments: [],
  },
  {
    id: "color-break",
    creatorId: "kai",
    title: "Take a tiny color break",
    caption:
      "A little moving color study for your scroll. Take a breath, unclench your shoulders, and stay a while. This is a silent demo animation.",
    art: "art",
    type: "video",
    likes: 129,
    time: "5 hours ago",
    comments: [],
  },
  {
    id: "cozy-corner",
    creatorId: "momo",
    title: "My favorite place to do nothing",
    caption:
      "A clean desk, a warm drink, and absolutely no plans. Sometimes that’s the whole mood. ☁️",
    art: "lifestyle",
    type: "photo",
    likes: 205,
    time: "6 hours ago",
    comments: [
      { name: "Sol · demo", text: "Saving this for my next room refresh!" },
    ],
  },
  {
    id: "cloud-layers",
    creatorId: "ren",
    title: "Dressed like a daydream",
    caption:
      "Soft layers for a slow afternoon. There are no rules to personal style—just things that make you feel a little more like you.",
    art: "fashion",
    type: "photo",
    likes: 97,
    time: "Yesterday",
    comments: [],
  },
  {
    id: "studio-friends",
    creatorId: "yuki",
    title: "Your people, your little corner",
    caption:
      "An imaginary afternoon with very real creative energy. Here’s to making space for every version of ourselves. 🎀",
    art: "community",
    type: "photo",
    likes: 367,
    time: "Yesterday",
    comments: [],
  },
  {
    id: "tiny-world",
    creatorId: "sol",
    title: "A corner of my tiny world",
    caption:
      "Dreaming up the reading nook for my next cozy-game build. Plants are always the answer. 🌱",
    art: "lifestyle",
    type: "photo",
    likes: 88,
    time: "Yesterday",
    comments: [],
  },
];

export function findCreator(username: string) {
  return creators.find((creator) => creator.username === username);
}

export function filterCreators(
  query: string,
  category: string = "All creators",
  blocked: string[] = [],
) {
  const normalized = query.trim().toLocaleLowerCase();
  return creators.filter(
    (creator) =>
      !blocked.includes(creator.id) &&
      (category === "All creators" || creator.category === category) &&
      `${creator.name} ${creator.username} ${creator.tagline} ${creator.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized),
  );
}

export function visiblePosts({
  blocked = [],
  following,
  saved,
  creatorId,
  type = "all",
}: {
  blocked?: string[];
  following?: string[];
  saved?: string[];
  creatorId?: string;
  type?: "all" | "photo" | "video";
} = {}) {
  return posts.filter(
    (post) =>
      !blocked.includes(post.creatorId) &&
      (!following || following.includes(post.creatorId)) &&
      (!saved || saved.includes(post.id)) &&
      (!creatorId || post.creatorId === creatorId) &&
      (type === "all" || post.type === type),
  );
}
