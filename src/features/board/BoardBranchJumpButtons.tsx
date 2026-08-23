import { formatAppMessage } from "../../i18n/format";

/**
 * The branch-replay control, shared by the shogi, chess and go viewers so the
 * mark stays identical across board types. The circle stands for the fork and is
 * set smaller than the chevron, which keeps the button as compact as the
 * single-glyph controls beside it.
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
  const mark = <span className="board-branch-jump-mark" aria-hidden="true">○</span>;
  const arrow = <span className="board-branch-jump-arrow" aria-hidden="true">{direction === "previous" ? "＜" : "＞"}</span>;
  return (
    <button
      type="button"
      className={`${className} board-branch-jump`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {direction === "previous" ? <>{mark}{arrow}</> : <>{arrow}{mark}</>}
    </button>
  );
}
