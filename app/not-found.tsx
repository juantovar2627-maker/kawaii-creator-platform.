import { Brand, EmptyState } from "@/components/community/primitives";

export default function NotFound() {
  return (
    <main className="max-w-xl mx-auto p-6 min-h-dvh flex flex-col justify-center gap-10">
      <Brand />
      <EmptyState
        title="A little off the beaten path"
        href="/"
        action="Back to your little corner"
      >
        This page or demo creator couldn’t be found. There are plenty of lovely
        things waiting back home.
      </EmptyState>
    </main>
  );
}
