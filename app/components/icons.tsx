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
 * Primary workspace navigation uses a roomier 24px optical grid than the
 * compact Radix action glyphs. The rounded, single-weight outlines stay clear
 * in both the desktop rail and the mobile tab bar.
 */
export function MainHomeIcon({
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
      <path d="m3.5 10.25 8.5-7 8.5 7" />
      <path d="M5.25 9.1v10.15c0 .69.56 1.25 1.25 1.25h3.05v-6.15h4.9v6.15h3.05c.69 0 1.25-.56 1.25-1.25V9.1" />
    </svg>
  );
}

export function MainTourIcon({
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
      <path d="m12 3.25 8 4.35v8.8l-8 4.35-8-4.35V7.6l8-4.35Z" />
      <path d="m4.35 7.8 7.65 4.15 7.65-4.15M12 11.95v8.35" />
    </svg>
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
      <path d="M6.25 4.25h11.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6.9l-4.6 3.5v-3.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
      <path d="M12 7.05c.36 1.72 1.23 2.59 2.95 2.95-1.72.36-2.59 1.23-2.95 2.95-.36-1.72-1.23-2.59-2.95-2.95 1.72-.36 2.59-1.23 2.95-2.95Z" />
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
