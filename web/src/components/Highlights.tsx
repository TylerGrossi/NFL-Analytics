import { Panel } from "@/components/ui";
import { clipLength, getGameHighlights } from "@/lib/espn";

/**
 * Highlight clips for one game, when ESPN has any.
 *
 * Renders nothing at all rather than an empty panel, because absence is the
 * normal case: clips ride along with a game for a few days and then drop out
 * of the feed. A game from last night has four or five; a regular-season game
 * six months old has none.
 *
 * Cards link out to ESPN's player rather than embedding their mp4. The feed
 * hands over a direct CDN url, but playing it here would use their bandwidth,
 * skip the advertising the clip exists to carry, and ignore the per-country
 * licensing the payload goes to the trouble of declaring.
 */
export async function Highlights({ eventId }: { eventId: string | null }) {
  if (!eventId) return null;
  const clips = await getGameHighlights(eventId);
  if (clips.length === 0) return null;

  return (
    <Panel title="Film" meta={`${clips.length} clip${clips.length === 1 ? "" : "s"} · ESPN`}>
      <div className="p-3 grid gap-3 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
        {clips.map((c) => (
          <a
            key={c.id}
            href={c.link}
            target="_blank"
            rel="noreferrer"
            className="group no-underline text-inherit"
          >
            <div className="relative rounded-[3px] overflow-hidden bg-panel-3 aspect-video border border-rule group-hover:border-rule-strong transition-colors">
              {c.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.thumbnail}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              )}
              <span
                className="absolute inset-0 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity"
                aria-hidden
              >
                <svg width="34" height="34" viewBox="0 0 34 34">
                  <circle cx="17" cy="17" r="16" fill="rgba(12,23,37,0.62)" />
                  <path d="M13.5 10.5 L24 17 L13.5 23.5 Z" fill="#fff" />
                </svg>
              </span>
              {c.duration !== null && (
                <span className="absolute bottom-1 right-1 num text-[10px] text-white bg-[rgba(12,23,37,0.78)] rounded-[2px] px-1 py-px">
                  {clipLength(c.duration)}
                </span>
              )}
            </div>
            <div className="text-[12px] leading-snug mt-1.5 group-hover:text-accent transition-colors">
              {c.headline}
            </div>
            {c.restricted && (
              <div className="text-[10.5px] text-ink-3 mt-0.5">
                Licensed to {c.restricted.join(", ")} only
              </div>
            )}
          </a>
        ))}
      </div>
      <div className="px-4 py-2.5 text-[11px] text-ink-3 border-t border-rule">
        Clips are hosted and served by ESPN; these are links, not embeds. They are attached to a
        game for a few days after it is played and then leave the feed, so older games show no
        film.
      </div>
    </Panel>
  );
}
