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
  FileTextIcon,
  EyeClosedIcon as RadixEyeClosedIcon,
  EyeOpenIcon as RadixEyeOpenIcon,
  GearIcon,
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
export const MinusIcon = fromRadix(RadixMinusIcon, "MinusIcon");
export const PlusIcon = fromRadix(RadixPlusIcon, "PlusIcon");

// The Agent uses a neutral wand glyph—never a colored app tile.
export const SparklesIcon = fromRadix(MagicWandIcon, "SparklesIcon");
