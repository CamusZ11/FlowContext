import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>;
}

export function PencilIcon(props: IconProps) { return <Icon {...props}><path d="m14.5 5.5 4 4M4 20l4.6-1 9.8-9.8a2.8 2.8 0 0 0-4-4L4.6 15z" /></Icon>; }
export function TrashIcon(props: IconProps) { return <Icon {...props}><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></Icon>; }
export function PlusIcon(props: IconProps) { return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>; }
export function ClockIcon(props: IconProps) { return <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></Icon>; }
export function CheckIcon(props: IconProps) { return <Icon {...props}><path d="m5 12 4.2 4.2L19 6.5" /></Icon>; }
export function ArrowRightIcon(props: IconProps) { return <Icon {...props}><path d="M5 12h14m-6-6 6 6-6 6" /></Icon>; }
export function SyncIcon(props: IconProps) { return <Icon {...props}><path d="M20 12a8 8 0 0 0-14.6-4.6M4 12a8 8 0 0 0 14.6 4.6M5.4 4.8v3.4h3.4m4.2 7.6v3.4h3.4" /></Icon>; }
export function FlowContextMark(props: IconProps) { return <Icon {...props}><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1m9.2 9.2 2.1 2.1m0-13.4-2.1 2.1m-9.2 9.2-2.1 2.1" /></Icon>; }
export function SyncedCloudIcon(props: IconProps) { return <Icon {...props}><path d="M7 18.5h10a3.7 3.7 0 0 0 .6-7.3A5.9 5.9 0 0 0 6.3 9.8 4.4 4.4 0 0 0 7 18.5Z" /><path d="M12 15.5V9.5m0 0-2.2 2.2M12 9.5l2.2 2.2" /></Icon>; }
export function SunIcon(props: IconProps) { return <Icon {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1-7.1-1.4 1.4M6.3 17.7l-1.4 1.4m14.2 0-1.4-1.4M6.3 6.3 4.9 4.9" /></Icon>; }
