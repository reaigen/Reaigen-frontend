import * as React from "react";
import {
  ArrowLeftIcon as RadixArrowLeftIcon,
  ArrowRightIcon as RadixArrowRightIcon,
  ArrowUpIcon as RadixArrowUpIcon,
  CheckIcon as RadixCheckIcon,
  ChevronDownIcon as RadixChevronDownIcon,
  ClockIcon as RadixClockIcon,
  CopyIcon as RadixCopyIcon,
  CounterClockwiseClockIcon,
  Cross2Icon,
  DashboardIcon,
  DotsHorizontalIcon,
  DragHandleDots2Icon,
  FileTextIcon,
  EyeClosedIcon as RadixEyeClosedIcon,
  EyeOpenIcon as RadixEyeOpenIcon,
  GearIcon,
  GridIcon as RadixGridIcon,
  HomeIcon as RadixHomeIcon,
  ImageIcon as RadixImageIcon,
  InfoCircledIcon,
  LayersIcon,
  LayoutIcon as RadixLayoutIcon,
  LightningBoltIcon,
  Link2Icon,
  LockClosedIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  OpenInNewWindowIcon,
  Pencil2Icon,
  PlayIcon as RadixPlayIcon,
  MinusIcon as RadixMinusIcon,
  PlusIcon as RadixPlusIcon,
  RulerSquareIcon,
  SewingPinIcon,
  Share2Icon,
  StarIcon as RadixStarIcon,
  TokensIcon,
  TrashIcon as RadixTrashIcon,
  UploadIcon as RadixUploadIcon,
  VideoIcon as RadixVideoIcon,
} from "@radix-ui/react-icons";

/**
 * Reaigen uses the same Radix-based icon vocabulary as ReaUI.
 * `size` keeps the existing product API while every glyph shares one optical grid.
 */
export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & { size?: number };

type RadixIconComponent = typeof RadixHomeIcon;

function fromRadix(Icon: RadixIconComponent, name: string) {
  function ReaigenIcon({ size = 18, width, height, ...props }: IconProps) {
    return (
      <Icon
        width={width ?? size}
        height={height ?? size}
        aria-hidden={props["aria-hidden"] ?? true}
        {...props}
      />
    );
  }
  ReaigenIcon.displayName = name;
  return ReaigenIcon;
}

// Primary navigation and product actions.
export const HomeIcon = fromRadix(RadixHomeIcon, "HomeIcon");
export const TourIcon = fromRadix(LayersIcon, "TourIcon");
export const ShareIcon = fromRadix(Share2Icon, "ShareIcon");
export const LinkIcon = fromRadix(Link2Icon, "LinkIcon");
export const SettingsIcon = fromRadix(GearIcon, "SettingsIcon");
export const SearchIcon = fromRadix(MagnifyingGlassIcon, "SearchIcon");

/**
 * Primary navigation glyphs.
 *
 * These share one optical grid so the rail reads as a single set: a 24px
 * viewBox, artwork bounded to roughly 3.9–20.1 on both axes, round caps and
 * joins, and one stroke weight driven by the caller. The rail previously mixed
 * these with Radix glyphs, which are filled artwork on a 15px grid — scaled up
 * to 21–22px they sat visibly lighter and on a different baseline than the
 * stroked ones next to them, which is what made the column look unaligned.
 *
 * Because they are stroked, `strokeWidth` actually does something here: the
 * active/inactive weight shift the shell asks for now renders.
 */
export type MainGlyphProps = IconProps & {
  /**
   * Solid glyph for the selected state, hollow otherwise.
   *
   * This mirrors both design references rather than being a flourish: the iOS
   * tab bar is built from SF Symbols' `.fill` variants (`house.fill`,
   * `gearshape.fill` — see ContentView.swift), and X marks its active tab the
   * same way. A rail of uniformly hollow glyphs is what made the web nav read
   * flatter than the app it mirrors.
   *
   * Filled variants are a single path with the inner detail as a subpath and
   * `fill-rule: evenodd`, so the door / triangle / gear bore punch through as
   * real holes instead of being painted in an assumed background colour.
   */
  filled?: boolean;
};

function MainGlyph({
  size = 18,
  width,
  height,
  strokeWidth = 1.7,
  filled = false,
  children,
  ...props
}: MainGlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width ?? size}
      height={height ?? size}
      fill={filled ? "currentColor" : "none"}
      fillRule={filled ? "evenodd" : undefined}
      clipRule={filled ? "evenodd" : undefined}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-hidden"] ?? true}
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * The roof and the walls used to be two strokes that crossed at the eaves —
 * the roofline ran the full width at y=11.15 while the wall started higher at
 * y=9.85, leaving a doubled line and two spurs poking out of the sides. This is
 * one continuous silhouette instead, with the door as the only inner mark.
 */
export function MainHomeIcon({ filled, ...props }: MainGlyphProps) {
  return (
    <MainGlyph filled={filled} {...props}>
      {filled ? (
        <path d="M3.9 10.4 12 4.05l8.1 6.35v7.75a2 2 0 0 1-2 2H5.9a2 2 0 0 1-2-2Zm5.85 9.75v-5.1a1.15 1.15 0 0 1 1.15-1.15h2.2a1.15 1.15 0 0 1 1.15 1.15v5.1Z" />
      ) : (
        <>
          <path d="M3.9 10.4 12 4.05l8.1 6.35v7.75a2 2 0 0 1-2 2H5.9a2 2 0 0 1-2-2Z" />
          <path d="M9.75 20.15v-5.1a1.15 1.15 0 0 1 1.15-1.15h2.2a1.15 1.15 0 0 1 1.15 1.15v5.1" />
        </>
      )}
    </MainGlyph>
  );
}

export function MainTourIcon({ filled, ...props }: MainGlyphProps) {
  return (
    <MainGlyph filled={filled} {...props}>
      {filled ? (
        // Rounded square spelled out as a path so the triangle can ride along
        // in the same `d` and be punched out by the even-odd rule.
        <path d="M8.5 3.9h7a4.6 4.6 0 0 1 4.6 4.6v7a4.6 4.6 0 0 1-4.6 4.6h-7a4.6 4.6 0 0 1-4.6-4.6v-7a4.6 4.6 0 0 1 4.6-4.6Zm1.95 5.25v5.7L15.55 12Z" />
      ) : (
        <>
          {/* Square, not the old 17.5×15.5 letterbox, so it occupies the same
              optical square as the house beside it. */}
          <rect x="3.9" y="3.9" width="16.2" height="16.2" rx="4.6" />
          {/* Filled *and* stroked: the fill gives it enough mass to match the
              house's density, the stroke rounds its corners to match everything
              else, and a bare fill at 18px read as a hard little wedge. */}
          <path d="M10.45 9.15 15.55 12l-5.1 2.85Z" fill="currentColor" />
        </>
      )}
    </MainGlyph>
  );
}

/**
 * Eight-tooth cog generated on the same 3.9–20.1 box rather than borrowed from
 * Radix, whose gear is filled artwork that ignores `strokeWidth`.
 */
const COG_OUTLINE = "M10.51 3.99A8.15 8.15 0 0 1 13.49 3.99L14.22 6.05A6.35 6.35 0 0 1 14.63 6.22L16.62 5.28A8.15 8.15 0 0 1 18.72 7.38L17.78 9.37A6.35 6.35 0 0 1 17.95 9.78L20.01 10.51A8.15 8.15 0 0 1 20.01 13.49L17.95 14.22A6.35 6.35 0 0 1 17.78 14.63L18.72 16.62A8.15 8.15 0 0 1 16.62 18.72L14.63 17.78A6.35 6.35 0 0 1 14.22 17.95L13.49 20.01A8.15 8.15 0 0 1 10.51 20.01L9.78 17.95A6.35 6.35 0 0 1 9.37 17.78L7.38 18.72A8.15 8.15 0 0 1 5.28 16.62L6.22 14.63A6.35 6.35 0 0 1 6.05 14.22L3.99 13.49A8.15 8.15 0 0 1 3.99 10.51L6.05 9.78A6.35 6.35 0 0 1 6.22 9.37L5.28 7.38A8.15 8.15 0 0 1 7.38 5.28L9.37 6.22A6.35 6.35 0 0 1 9.78 6.05L10.51 3.99Z";
/** The bore, as a path so it can share the cog's `d` and be punched out. */
const COG_BORE = "M12 8.95a3.05 3.05 0 1 0 0 6.1 3.05 3.05 0 0 0 0-6.1Z";

export function MainSettingsIcon({ filled, ...props }: MainGlyphProps) {
  return (
    <MainGlyph filled={filled} {...props}>
      {filled ? (
        <path d={`${COG_OUTLINE}${COG_BORE}`} />
      ) : (
        <>
          <path d={COG_OUTLINE} />
          <circle cx="12" cy="12" r="3.05" />
        </>
      )}
    </MainGlyph>
  );
}

export function MainSignOutIcon(props: IconProps) {
  return (
    <MainGlyph {...props}>
      <path d="M14.15 4.35H6.9a2 2 0 0 0-2 2v11.3a2 2 0 0 0 2 2h7.25" />
      <path d="M11.6 12h8.3" />
      <path d="m17.15 9.25 2.75 2.75-2.75 2.75" />
    </MainGlyph>
  );
}

export function AgentIcon({
  size = 18,
  width,
  height,
  strokeWidth = 1.8,
  ...props
}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width ?? size}
      height={height ?? size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-hidden"] ?? true}
      {...props}
    >
      <path d="M12 3.25c.42 4.92 2.83 7.33 7.75 7.75-4.92.42-7.33 2.83-7.75 7.75-.42-4.92-2.83-7.33-7.75-7.75 4.92-.42 7.33-2.83 7.75-7.75Z" />
      <circle cx="18.75" cy="4.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Property and editor semantics.
export const LayoutIcon = fromRadix(DashboardIcon, "LayoutIcon");
export const RulerIcon = fromRadix(RulerSquareIcon, "RulerIcon");
export const PriceIcon = fromRadix(TokensIcon, "PriceIcon");
export const DocumentIcon = fromRadix(FileTextIcon, "DocumentIcon");
export const TechnicalIcon = fromRadix(MixerHorizontalIcon, "TechnicalIcon");
export const UtilitiesIcon = fromRadix(LightningBoltIcon, "UtilitiesIcon");
export const StarIcon = fromRadix(RadixStarIcon, "StarIcon");
export const InfoIcon = fromRadix(InfoCircledIcon, "InfoIcon");
export const MapPinIcon = fromRadix(SewingPinIcon, "MapPinIcon");
export const EditIcon = fromRadix(Pencil2Icon, "EditIcon");
export const VersionsIcon = fromRadix(CounterClockwiseClockIcon, "VersionsIcon");
export const ImageIcon = fromRadix(RadixImageIcon, "ImageIcon");
export const VideoIcon = fromRadix(RadixVideoIcon, "VideoIcon");
export const UploadIcon = fromRadix(RadixUploadIcon, "UploadIcon");
export const EyeOpenIcon = fromRadix(RadixEyeOpenIcon, "EyeOpenIcon");
export const EyeClosedIcon = fromRadix(RadixEyeClosedIcon, "EyeClosedIcon");
export const FloorplanIcon = fromRadix(RadixLayoutIcon, "FloorplanIcon");
export const GridIcon = fromRadix(RadixGridIcon, "GridIcon");
export const LockIcon = fromRadix(LockClosedIcon, "LockIcon");

// Direction, state, and utility actions.
export const PlayIcon = fromRadix(RadixPlayIcon, "PlayIcon");
export const ArrowLeftIcon = fromRadix(RadixArrowLeftIcon, "ArrowLeftIcon");
export const ArrowRightIcon = fromRadix(RadixArrowRightIcon, "ArrowRightIcon");
export const ArrowUpIcon = fromRadix(RadixArrowUpIcon, "ArrowUpIcon");
export const ChevronDownIcon = fromRadix(RadixChevronDownIcon, "ChevronDownIcon");
export const CloseIcon = fromRadix(Cross2Icon, "CloseIcon");
export const CheckIcon = fromRadix(RadixCheckIcon, "CheckIcon");
export const CopyIcon = fromRadix(RadixCopyIcon, "CopyIcon");
export const ClockIcon = fromRadix(RadixClockIcon, "ClockIcon");
export const ExternalLinkIcon = fromRadix(OpenInNewWindowIcon, "ExternalLinkIcon");
export const MoreIcon = fromRadix(DotsHorizontalIcon, "MoreIcon");
export const DragHandleIcon = fromRadix(DragHandleDots2Icon, "DragHandleIcon");
export const MinusIcon = fromRadix(RadixMinusIcon, "MinusIcon");
export const PlusIcon = fromRadix(RadixPlusIcon, "PlusIcon");
export const TrashIcon = fromRadix(RadixTrashIcon, "TrashIcon");

export function OrbitIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <circle cx="12" cy="12" r="2.25" />
      <path d="M4.25 12c0-4.55 3.47-8.25 7.75-8.25 2.9 0 5.43 1.7 6.75 4.2" />
      <path d="m18.9 4.8.25 3.6-3.55-.55" />
      <path d="M19.75 12c0 4.55-3.47 8.25-7.75 8.25-2.9 0-5.43-1.7-6.75-4.2" />
      <path d="m5.1 19.2-.25-3.6 3.55.55" />
    </svg>
  );
}

export function FrameIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function CameraIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <rect x="4" y="7" width="12" height="10" rx="2" />
      <path d="m16 10 4-2v8l-4-2" />
      <circle cx="10" cy="12" r="2.25" />
    </svg>
  );
}

export function RotateIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <path d="M19.2 8.3A8 8 0 1 0 20 14" />
      <path d="M19.2 4.6v3.7h-3.7" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function SelectIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <path d="m5 3 13 8-6.2 1.45L9 19Z" />
      <path d="m12.1 12.4 4.6 5.6" />
    </svg>
  );
}

export function MoveIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <path d="M12 3v18M3 12h18" />
      <path d="m9 6 3-3 3 3M18 9l3 3-3 3M9 18l3 3 3-3M6 9l-3 3 3 3" />
    </svg>
  );
}

export function ScaleIcon({ size = 18, width, height, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={width ?? size} height={height ?? size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props["aria-hidden"] ?? true} {...props}>
      <path d="M4 10V4h6M14 20h6v-6" />
      <path d="m9 9-5-5M15 15l5 5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

// The Agent uses a neutral wand glyph—never a colored app tile.
export const SparklesIcon = fromRadix(MagicWandIcon, "SparklesIcon");
