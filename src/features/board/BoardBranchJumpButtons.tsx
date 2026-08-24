import { formatAppMessage } from "../../i18n/format";

/**
 * The branch-replay control, shared by the shogi, chess and go viewers so the
 * mark stays identical across board types.
 *
 * Drawn rather than typed. The control sits in a row of lucide icons, and a
 * text glyph could not match them: font metrics decide its weight and size, it
 * never lines up on the same optical baseline, and the circle came out far
 * larger than the dot it is meant to be. This is the same 24-unit grid, stroke
 * width and cap style the neighbouring icons use, so it reads as one of them.
 * The chevron is the movement and the dot is the fork it stops at.
 */
export function BoardBranchJumpButton({
  className,
  direction,
  disabled,
  onClick,
}: {
  className: string;
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const label = formatAppMessage(direction === "previous" ? "board.navigation.previousBranch" : "board.navigation.nextBranch");
  return (
    <button
      type="button"
      className={`${className} board-branch-jump`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {direction === "previous" ? (
          <>
            <circle cx="8" cy="12" r="2.5" fill="currentColor" stroke="none" />
            <path d="M19 6l-6 6 6 6" />
          </>
        ) : (
          <>
            <path d="M5 6l6 6-6 6" />
            <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
    </button>
  );
}
