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

/** Primary workspace glyphs use one bold 24px optical grid. */
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
      <path d="m3.25 11.15 7.95-6.9a1.25 1.25 0 0 1 1.6 0l7.95 6.9" />
      <path d="M5.25 9.85v8.4a2 2 0 0 0 2 2H9.5v-5.5h5v5.5h2.25a2 2 0 0 0 2-2v-8.4" />
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
      <path d="M19.7 8.4C18.25 5.85 15.35 4.25 12 4.25c-3.95 0-7.3 2.25-8.45 5.4" />
      <path d="m16.35 8.25 3.55.4.35-3.55" />
      <path d="M4.3 15.6c1.45 2.55 4.35 4.15 7.7 4.15 3.95 0 7.3-2.25 8.45-5.4" />
      <path d="m7.65 15.75-3.55-.4-.35 3.55" />
      <circle cx="12" cy="12" r="2.35" />
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
