import { type ReactNode } from "react";

// Inline strokes avoid an icon dependency and stay available without network access.
function Icon({ children, size = 18 }: { readonly children: ReactNode; readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="kg-icon"
    >
      {children}
    </svg>
  );
}

interface IconProps {
  readonly size?: number;
}

export function LibraryIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3.5" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="4.5" height="16" rx="1" />
      <path d="m16.4 5.2 3.9-.9 2.2 15.3-3.9.9z" />
    </Icon>
  );
}

export function DiscoverIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5.5 5.5" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
    </Icon>
  );
}

export function GridIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="4" y="4" width="6.5" height="8" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="8" rx="1" />
      <rect x="4" y="15" width="6.5" height="5" rx="1" />
      <rect x="13.5" y="15" width="6.5" height="5" rx="1" />
    </Icon>
  );
}

export function ListIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="4" y="5" width="3.5" height="4" rx=".6" />
      <rect x="4" y="15" width="3.5" height="4" rx=".6" />
      <path d="M10.5 7h9.5M10.5 17h9.5" />
    </Icon>
  );
}

export function SearchIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </Icon>
  );
}

export function BackIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function FolderIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </Icon>
  );
}

export function CodeIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />
    </Icon>
  );
}

export function RefreshIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </Icon>
  );
}

export function AlertIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </Icon>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}
