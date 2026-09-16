import { type CSSProperties } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { generatedCover } from "./library.model.ts";

export const CoverSize = { Thumb: "thumb", Card: "card", Hero: "hero" } as const;
export type CoverSize = (typeof CoverSize)[keyof typeof CoverSize];

/**
 * No real cover art source exists yet. The generated cover is labelled as such and uses a
 * typographic motif, so it cannot be mistaken for an image supplied by a publisher or user.
 */
export function GeneratedCover({
  id,
  title,
  size
}: {
  readonly id: string;
  readonly title: string;
  readonly size: CoverSize;
}) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const cover = generatedCover(id, title, locale.language.value);
  return (
    <div
      className="kg-cover"
      data-size={size}
      data-motif={cover.motif}
      style={{ "--kg-cover-hue": cover.hue } as CSSProperties}
      aria-hidden="true"
    >
      <span className="kg-cover-glyph">{cover.glyph}</span>
      {size === CoverSize.Hero && <span className="kg-cover-title">{title}</span>}
      {size !== CoverSize.Thumb && (
        <span className="kg-cover-tag">{t("library:generatedCover")}</span>
      )}
    </div>
  );
}
